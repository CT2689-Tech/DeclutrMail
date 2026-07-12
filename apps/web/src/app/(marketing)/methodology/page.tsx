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
  title: 'Methodology — DeclutrMail',
  description:
    'The inspectable boundaries behind DeclutrMail: metadata-only Gmail indexing, deterministic recommendations, mandatory previews, and explicit Pro automation.',
  path: '/methodology',
});

export default function MethodologyPage() {
  return (
    <ProductStoryShell
      eyebrow="Methodology"
      title="The product boundary, in plain English."
      lede="DeclutrMail is a Gmail companion built around explicit sender decisions. Gmail remains the reading and reply surface; DeclutrMail narrows the cleanup problem and shows its work before acting."
    >
      <StorySection
        id="walkthrough"
        number="01"
        title="Store enough to help. Stop before the body."
        intro={
          <p>
            The privacy badge describes Gmail message data specifically. The service also stores the
            connected account&rsquo;s identity, preferences, sender decisions, Activity records, and
            billing records needed to operate the account; it does not store full card numbers.
          </p>
        }
      >
        <DataBoundaryFigure />
        <details className="dm-story-deep">
          <summary>For the curious: what “Gmail Preview” means</summary>
          <p>
            Gmail Preview is the short snippet Gmail itself computes for an inbox row. DeclutrMail
            receives that field through Gmail&rsquo;s metadata response. It does not download or
            parse the full message body to create the preview.
          </p>
        </details>
      </StorySection>

      <StorySection
        id="recommendations"
        number="02"
        title="Recommendations are a visible cascade, not a predicted category."
        intro={
          <p>
            The verdict comes from deterministic rules over metadata facts. Protect and strong
            engagement take precedence; insufficient evidence becomes Later; otherwise the engine
            compares Archive and Unsubscribe using inspectable signals. It does not use machine
            learning to predict email categories.
          </p>
        }
      >
        <RecommendationCascadeFigure />
        <details className="dm-story-deep">
          <summary>Where language generation fits</summary>
          <p>
            When configured, Anthropic may rewrite the recommendation explanation into one or two
            plain-English sentences. That explanation path receives bounded metadata facts such as
            sender identity, the deterministic verdict, confidence, rule label, volume, read rate,
            and Gmail&rsquo;s own category label. It does not receive a message subject, Gmail
            Preview, or full body. A deterministic template is the fallback.
          </p>
        </details>
      </StorySection>

      <StorySection
        id="brief-boundary"
        number="03"
        title="The Pro Brief has a separate, narrower AI path."
        intro={
          <p>
            When an AI-generated Brief narrative is available, DeclutrMail can send bounded sender
            identity, subject, and Gmail Preview text to Anthropic to draft it. Full message bodies,
            attachments, inline images, and raw MIME are not sent. A deterministic template is the
            fallback.
          </p>
        }
        tone="ink"
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Included in the Brief prompt</h3>
            <p>
              Bounded sender identity, subject, Gmail Preview text, and the small set of Brief facts
              needed to draft the narrative.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Outside the boundary</h3>
            <p>
              Full bodies, HTML, attachments, inline images, raw MIME, and non-allowlisted headers.
            </p>
          </article>
        </div>
        <p className="dm-story-callout">
          This methodology makes no claim about Anthropic&rsquo;s retention or training terms. Those
          are provider-policy questions, distinct from the payload boundary described here.
        </p>
      </StorySection>

      <StorySection
        id="action-method"
        number="04"
        title="Intent, preview, confirmation, evidence."
        intro={
          <p>
            Mailbox changes follow a staged lifecycle. The preview is the commitment boundary: if it
            cannot load, the action cannot be confirmed. Activity records the confirmed Gmail
            mutation or the result returned by a sender&rsquo;s unsubscribe endpoint, not an
            optimistic client guess.
          </p>
        }
      >
        <ActionLifecycleFigure />
      </StorySection>

      <StorySection
        id="automation-method"
        number="05"
        title="A current action never smuggles in a future rule."
        intro={
          <p>
            Manual cleanup and future automation are separate concepts. Pro Autopilot uses preset
            rules, starts them in Observe, and requires a deliberate switch to Active before future
            matches can be changed.
          </p>
        }
      >
        <AutomationBoundaryFigure />
      </StorySection>

      <StorySection
        id="access-and-control"
        number="06"
        title="Access is broad enough to act, constrained in use."
        intro={
          <p>
            Google&rsquo;s <code>gmail.modify</code> scope permits the label changes DeclutrMail
            needs. The implementation constrains message fetching to metadata format and an
            allowlist. OAuth tokens are encrypted at rest and never sent to the browser.
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
            <h3>Read the operational detail</h3>
            <p>
              The <a href="/security">Security page</a> explains OAuth and encryption. The{' '}
              <a href="/privacy">Privacy Policy</a> covers stored account data, subprocessors,
              access controls, and deletion.
            </p>
          </article>
        </div>
      </StorySection>

      <StorySection
        id="honest-limits"
        number="07"
        title="What this method does not promise."
        intro={
          <p>
            Product trust includes visible limits. These are constraints to understand, not details
            hidden behind a demo.
          </p>
        }
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
              Mailbox size and Gmail rate limits affect the initial metadata scan. The product shows
              stage and progress instead of promising a fixed completion time.
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
            <h3>The recommendation is advisory</h3>
            <p>
              Confidence is evidence, not authority. You can choose a different action, and Protect
              remains an explicit user-controlled shield.
            </p>
          </article>
        </div>
      </StorySection>

      <FinalStoryCta
        title="Use the method on a real sender queue."
        body="Connect Gmail, inspect the metadata boundary, and confirm only the cleanup choices that make sense for your inbox."
      />
    </ProductStoryShell>
  );
}
