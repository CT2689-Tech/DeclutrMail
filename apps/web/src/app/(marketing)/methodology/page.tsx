import type { Metadata } from 'next';

import '@/features/marketing/product-story/product-story.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import {
  ActionLifecycleFigure,
  AutomationBoundaryFigure,
  DataBoundaryFigure,
  FinalStoryCta,
  ProductStoryShell,
  RecommendationCascadeFigure,
  StorySection,
} from '@/features/marketing/product-story';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Privacy and control — DeclutrMail',
  description:
    'What DeclutrMail stores from Gmail, how suggestions are made, what changes before you confirm, and when automation can run.',
  path: '/methodology',
});

export default function MethodologyPage() {
  return (
    <ProductStoryShell
      eyebrow="Privacy & control"
      title="What DeclutrMail can see and change."
      lede="DeclutrMail uses a limited set of Gmail details, shows you each manual change before it happens, and keeps those decisions separate from automatic rules. Gmail remains where you read and reply."
    >
      <StorySection
        id="walkthrough"
        number="01"
        title="We store only the Gmail details we need."
        intro={
          <p>
            The list below covers the Gmail details DeclutrMail stores. We also keep the account
            information, preferences, decisions, Activity history, and billing records needed to run
            your account. We do not store full card numbers.
          </p>
        }
      >
        <DataBoundaryFigure />
        <details className="dm-story-deep">
          <summary>What the Gmail preview snippet contains</summary>
          <p>
            This is the short text Gmail already shows in your inbox list. DeclutrMail receives it
            directly from Gmail and does not download the full email to create it.
          </p>
        </details>
      </StorySection>

      <StorySection
        id="recommendations"
        number="02"
        title="Suggestions come from clear rules, not guessed categories."
        intro={
          <p>
            Protected and frequently used senders are handled first. New or low-volume senders are
            suggested for Later. For the rest, DeclutrMail compares Archive and Unsubscribe using
            facts such as volume and read rate. It does not use machine learning to guess email
            categories.
          </p>
        }
      >
        <RecommendationCascadeFigure />
        <details className="dm-story-deep">
          <summary>Where language generation fits</summary>
          <p>
            Anthropic may turn the selected sender facts into a short explanation. It receives the
            sender, suggested action, volume, read rate, and Gmail&rsquo;s own category label. It
            does not receive subject lines, preview snippets, or full email contents for this
            explanation. If Anthropic is unavailable, DeclutrMail shows a standard explanation.
          </p>
        </details>
      </StorySection>

      <StorySection
        id="brief-boundary"
        number="03"
        title="What Anthropic receives for a Pro Brief."
        intro={
          <p>
            DeclutrMail can send the sender, subject line, and Gmail preview snippet to Anthropic to
            draft a Pro Brief. Full email contents, attachments, embedded images, and raw email
            source are not sent. If Anthropic is unavailable, DeclutrMail uses a standard summary.
          </p>
        }
        tone="ink"
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Sent for the Brief</h3>
            <p>
              Sender, subject line, Gmail preview snippet, and the small set of facts needed to
              draft the summary.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Never sent for the Brief</h3>
            <p>
              Full email contents, email HTML, attachments, embedded images, raw email source, and
              other email headers.
            </p>
          </article>
        </div>
        <p className="dm-story-callout">
          Anthropic sets its own retention and training terms. DeclutrMail&rsquo;s privacy policy
          links to those terms and explains when Anthropic receives data.
        </p>
      </StorySection>

      <StorySection
        id="action-method"
        number="04"
        title="Nothing changes until the preview loads."
        intro={
          <p>
            Before you confirm, DeclutrMail shows how many emails are affected, a sample when
            available, and what will change in Gmail. If that preview cannot load, the action cannot
            run. Activity records the result after Gmail or the sender confirms it.
          </p>
        }
      >
        <ActionLifecycleFigure />
      </StorySection>

      <StorySection
        id="automation-method"
        number="05"
        title="A manual decision does not create an automatic rule."
        intro={
          <p>
            Archive, Later, and Delete affect only the email shown before you confirm. Autopilot is
            separate: only rules you deliberately turn on handle future matches, and you see what a
            rule would do before you turn it on.
          </p>
        }
      >
        <AutomationBoundaryFigure />
      </StorySection>

      <StorySection
        id="access-and-control"
        number="06"
        title="Why DeclutrMail asks to organize Gmail."
        intro={
          <p>
            Google names this permission <code>gmail.modify</code>. It lets DeclutrMail move email
            out of Inbox, add labels, and move email to Trash. DeclutrMail requests only the listed
            Gmail details, encrypts the Google access token, and never sends that token to your
            browser.
          </p>
        }
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Control stays available</h3>
            <p>
              Revoke Google access, disconnect an inbox from the account menu, export your data, or
              schedule deletion of the whole DeclutrMail account from Settings. Disconnecting
              preserves historical DeclutrMail records for reconnection.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Read more about security and privacy</h3>
            <p>
              The <a href="/security">Security page</a> explains OAuth and encryption. The{' '}
              <a href="/privacy">Privacy Policy</a> covers stored account data, the other companies
              that help provide the service, access controls, and deletion.
            </p>
          </article>
        </div>
      </StorySection>

      <StorySection
        id="honest-limits"
        number="07"
        title="Limits you should know."
        intro={<p>DeclutrMail is explicit about what it cannot guarantee.</p>}
        tone="ink"
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Gmail, on the web</h3>
            <p>
              DeclutrMail is currently a web companion for Gmail. It is not a universal mailbox or a
              replacement Gmail reader.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Sync time varies</h3>
            <p>
              Mailbox size and Gmail&rsquo;s limits affect the first scan. DeclutrMail shows
              progress instead of promising a fixed completion time.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Unsubscribe is a request</h3>
            <p>
              A sender can ignore or delay an unsubscribe request. Once a one-click request is
              delivered, DeclutrMail cannot recall it.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Suggestions are optional</h3>
            <p>
              You can always choose a different action. Protect remains a separate control that
              keeps a sender out of bulk and automatic changes.
            </p>
          </article>
        </div>
      </StorySection>

      <FinalStoryCta
        title="See these safeguards in the product."
        body="Connect Gmail, review the details DeclutrMail stores, and confirm only the changes that make sense for your inbox."
      />
    </ProductStoryShell>
  );
}
