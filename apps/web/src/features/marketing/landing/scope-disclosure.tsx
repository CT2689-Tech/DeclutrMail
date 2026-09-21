import { OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';

/**
 * Pre-consent scope disclosure (copy contract in
 * packages/shared/src/copy/privacy.ts). The landing page renders it beside
 * each CTA that starts Google OAuth (hero and final CTA); the /sign-in entry
 * page carries it in full.
 *
 * Collapsed by default. The disclosure renders VERBATIM inside; the summary
 * is a neutral label that makes no claim of its own, so the locked copy is
 * never paraphrased, sliced, or summarised to fit. Native <details> keeps
 * this a Server Component with zero client JS.
 *
 * The /sign-in link rides INSIDE the disclosure: the deeper read sits
 * exactly where someone who opened the summary is already looking.
 */
export function ScopeDisclosure() {
  return (
    <details className="dm-mkt-scope">
      <summary>What Google will ask you to allow</summary>
      <p>
        {OAUTH_SCOPE_DISCLOSURE}{' '}
        <a href="/sign-in">See what DeclutrMail can and can&rsquo;t access →</a>
      </p>
    </details>
  );
}
