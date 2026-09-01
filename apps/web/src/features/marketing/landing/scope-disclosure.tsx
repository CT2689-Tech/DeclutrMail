import { OAUTH_SCOPE_DISCLOSURE } from '@declutrmail/shared';

/**
 * Pre-consent scope disclosure, rendered beside every CTA that starts
 * Google OAuth (copy contract in packages/shared/src/copy/privacy.ts).
 *
 * Collapsed by default. The locked disclosure runs 40 words at 11px mono
 * and appears beside BOTH landing CTAs, which made it the single largest
 * duplicated block on the page — roughly 12 of the mobile viewport's
 * lines spent restating one paragraph.
 *
 * The disclosure renders VERBATIM inside; the summary is a neutral label
 * that makes no claim of its own, so the locked copy is never
 * paraphrased, sliced, or summarised to fit. Native <details> keeps this
 * a Server Component with zero client JS.
 *
 * The /sign-in link rides INSIDE the disclosure rather than sitting as a
 * sibling note beneath it. Both explain the same thing — one inline, one
 * by navigation — so stacked they read as two separate obligations. Here
 * the deeper read sits exactly where someone who opened the summary is
 * already looking, and the collapsed hero is one line shorter.
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
