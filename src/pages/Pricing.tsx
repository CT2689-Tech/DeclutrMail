import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useState } from "react";
import { PageMast } from "@/components/brand";

/**
 * Pricing — DeclutrMail's tier comparison page.
 *
 * Source: /tmp/declutr-design-bd3l/.../marketing/pricing.html (230 lines
 * canonical) plus billing.jsx (Pro Pass: $12 / 7-day one-time pass).
 *
 * Creative annual-push design (calm-operator voice, not shouty):
 *   - Monthly/Yearly toggle above the tiers, defaulting to Yearly
 *   - Pro tier dynamically shows yearly ($59/yr) or monthly ($9/mo)
 *   - Yearly state shows italic Fraunces savings accent: "Five months
 *     on us" + "Don't think about it again until 2027" framing —
 *     emphasizes the calm-operator/set-and-forget brand value
 *   - Monthly state shows a subtle one-line "Or save $49 with annual →"
 *     hint, no aggressive nag
 *   - Free, Pro Pass, Team are billing-period-independent (no change)
 *
 * Built against docs/marketing-pages.md:
 *   - 4 italic accents total (hero, conv banner, footer tagline, Pro
 *     savings accent when Yearly selected)
 *   - All italic uses WONK 0 + SOFT 100
 *   - Body sizes: 17 LEAD / 15 BODY / 13.5 SMALL
 *   - Tier descs describe audience; lists describe features (no overlap)
 *   - Tier inheritance reads left-to-right (Free → Pro → Pro Pass → Team)
 */

type BillingPeriod = "monthly" | "yearly";

const PRO_MONTHLY = 9;
const PRO_YEARLY = 59;
// $9 × 12 = $108/yr at monthly billing → $108 − $59 = $49 saved on annual.

export default function Pricing() {
  const [period, setPeriod] = useState<BillingPeriod>("yearly");
  const isYearly = period === "yearly";

  return (
    <>
      <Helmet>
        <title>Pricing — DeclutrMail</title>
        <meta
          name="description"
          content="Free to start. Pro Pass for a one-time 7-day cleanup. Pro for ongoing automatic cleanups — pay yearly and save $49. Teams ship Q3 2026."
        />
      </Helmet>

      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <PageMast
        brandHref="/"
        navLinks={[
          { label: "Product", href: "/" },
          { label: "How it works", href: "/how-it-works" },
          { label: "Pricing", href: "/pricing", active: true },
          { label: "Compare", href: "/compare" },
          { label: "Privacy", href: "/privacy" },
        ]}
        ctaLabel="Sign in"
        ctaHref="/sign-in"
      />

      <main id="main">
        <section className="hero">
          <div className="container">
            <div className="eyebrow kicker">— Pricing —</div>
            <h1 className="display">
              Free to start. <em>Easy to undo.</em>
            </h1>
            <p className="deck">
              No credit card to try. Pro Pass clears a one-time mess for $12. Pro adds nightly
              automatic cleanups — pay yearly and save $49. Cancel any time; your activity log stays
              in your account for two years either way.
            </p>
          </div>
        </section>

        {/* Tiers */}
        <section className="section">
          <div className="container">
            {/* Billing-period toggle */}
            <div className="billing-toggle-wrap">
              <div className="billing-toggle" role="group" aria-label="Pro billing period">
                <button type="button" aria-pressed={!isYearly} onClick={() => setPeriod("monthly")}>
                  Monthly
                </button>
                <button type="button" aria-pressed={isYearly} onClick={() => setPeriod("yearly")}>
                  Yearly
                  <span className="badge">save $49</span>
                </button>
              </div>
            </div>

            <div className="tiers">
              {/* Free — baseline */}
              <div className="tier">
                <h3>Free</h3>
                <div className="price">
                  $0
                  <small>Forever · one Gmail</small>
                </div>
                <p className="desc">For anyone who wants to see what a clean inbox looks like.</p>
                <ul>
                  <li>One Gmail account</li>
                  <li>
                    Up to <strong>10</strong> cleanup actions, lifetime — archiving 1,847 from
                    LinkedIn counts as one
                  </li>
                  <li>All four actions · Archive, Mute, Unsubscribe, Keep</li>
                  <li>7-day undo on every action</li>
                  <li>Plain-English reasons on every classification</li>
                  <li>Activity log · last 30 days</li>
                </ul>
                <div className="footer">
                  <Link
                    to="/sign-in"
                    className="btn btn-ghost"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Start free →
                  </Link>
                </div>
              </div>

              {/* Pro — featured, period-aware */}
              <div className="tier featured">
                <span
                  className="eyebrow eyebrow-primary"
                  style={{ display: "block", marginBottom: 6 }}
                >
                  — Most popular —
                </span>
                <h3>Pro</h3>
                {isYearly ? (
                  <>
                    <div className="price">
                      ${PRO_YEARLY}
                      <small>Per year · don’t think about it again until 2027</small>
                    </div>
                    <em className="savings">Five months on us.</em>
                  </>
                ) : (
                  <>
                    <div className="price">
                      ${PRO_MONTHLY}
                      <small>Per month · pause anytime</small>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPeriod("yearly")}
                      className="btn-link"
                      style={{
                        display: "inline-block",
                        marginTop: 8,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        font: "inherit",
                        fontSize: 13,
                      }}
                    >
                      Or save $49 with annual →
                    </button>
                  </>
                )}
                <p className="desc" style={{ marginTop: 16 }}>
                  For the user with eight years of inbox and zero patience for it.
                </p>
                <ul>
                  <li>
                    <strong>Everything in Free</strong>, plus:
                  </li>
                  <li>
                    <strong>Unlimited cleanup actions</strong>
                  </li>
                  <li>
                    <strong>Nightly automatic cleanups</strong> (per-sender &amp; per-category)
                  </li>
                  <li>Plain-English and detailed views on every classification</li>
                  <li>Natural-language rule creator (⌘K)</li>
                  <li>Full activity log · export anytime</li>
                  <li>Priority email support · within 24 hours</li>
                </ul>
                <div className="footer">
                  <Link
                    to={`/sign-in?plan=pro&period=${period}`}
                    className="btn btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Start Pro {isYearly ? "· annual" : "· monthly"} →
                  </Link>
                </div>
              </div>

              {/* Pro Pass — all of Pro, time-boxed to 7 days */}
              <div className="tier">
                <h3>Pro Pass</h3>
                <div className="price">
                  $12
                  <small>One-time · 7 days</small>
                </div>
                <p className="desc">
                  For the one-shot cleanup. Buy once, clear the years of clutter, drop back to Free.
                </p>
                <ul>
                  <li>
                    <strong>Everything in Pro</strong>, for 7 days
                  </li>
                  <li>One-time $12 — no subscription</li>
                  <li>No auto-renew · ever</li>
                  <li>Drops back to Free on day 8 automatically</li>
                </ul>
                <div className="footer">
                  <Link
                    to="/sign-in?plan=pass"
                    className="btn btn-ghost"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Get the pass →
                  </Link>
                </div>
              </div>

              {/* Team — coming soon */}
              <div className="tier" style={{ position: "relative", opacity: 0.92 }}>
                <span
                  className="eyebrow"
                  style={{
                    display: "block",
                    marginBottom: 6,
                    color: "hsl(var(--warning-strong))",
                  }}
                >
                  — Coming Q3 2026 —
                </span>
                <h3>Team</h3>
                <div
                  className="price"
                  style={{ fontSize: 28, letterSpacing: "-0.005em", lineHeight: 1.1 }}
                >
                  <span style={{ fontSize: "1em" }}>Coming soon</span>
                  <small>Q3 2026 · join the waitlist</small>
                </div>
                <p className="desc">For ops, sales, support — teams that share an inbox problem.</p>
                <ul>
                  <li>
                    <strong>Everything in Pro</strong>, plus:
                  </li>
                  <li>Multiple Gmail accounts per workspace</li>
                  <li>Admin console · per-seat activity logs</li>
                  <li>Workspace-level rules · applied per role</li>
                  <li>SAML SSO · Google Workspace</li>
                  <li>Tamper-proof signed activity logs</li>
                  <li>Dedicated support channel</li>
                </ul>
                <div className="footer">
                  <Link
                    to="/contact?team=1"
                    className="btn btn-ghost"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Join waitlist →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Honest pricing notes */}
        <section className="section alt">
          <div className="container">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "clamp(26px, 2.8vw, 36px)",
                lineHeight: 1.15,
                letterSpacing: "-0.018em",
                margin: "0 0 22px",
              }}
            >
              A few notes <em>on the price.</em>
            </h2>

            <div className="twoup">
              <div>
                <p>
                  We don’t charge for the AI features, because we don’t pay for them the way our
                  competitors do. Most senders we already recognize without asking an AI. Only the
                  unusual ones trigger an AI lookup — and we send only sender info, never your
                  messages.
                </p>
                <p>
                  That’s why our price looks like a cleanup tool ($9/mo or $59/yr) instead of like
                  an AI coworker ($20–40/mo). You’re paying for the cleanup, not the AI calls.
                </p>
              </div>
              <div>
                <p>
                  Annual saves you $49 because we save on the payment processor’s monthly cut and
                  pass it through. No teaser pricing, no countdown — the math is the math, and you
                  can switch billing at any time from Settings.
                </p>
                <p>
                  Cancel and your account stays read-only for two years. The activity log doesn’t go
                  away. Refunds within 30 days, no questions. If you switch from Free to Pro
                  mid-cycle, we prorate the next bill.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing FAQ */}
        <section className="section">
          <div className="container">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "clamp(26px, 2.8vw, 36px)",
                lineHeight: 1.15,
                letterSpacing: "-0.018em",
                margin: "0 0 22px",
              }}
            >
              Pricing FAQ
            </h2>

            <div className="qa">
              <details>
                <summary>Is there a free trial of Pro?</summary>
                <p className="a">
                  Free isn’t a trial — it’s a permanent tier with a generous starter allowance. 10
                  sender-level cleanup actions is usually enough to clear most of a first-time mess
                  (one action archives every message from one sender). For a one-shot bigger
                  cleanup, Pro Pass is $12 for 7 days of unlimited Pro. For ongoing cleanup, Pro is
                  $9/month or $59/year. We’d rather price clearly than dangle a 14-day countdown.
                </p>
              </details>
              <details>
                <summary>Can I switch between monthly and yearly later?</summary>
                <p className="a">
                  Yes, any time from Settings → Billing. If you switch from monthly to annual
                  mid-cycle, we prorate. If you switch annual to monthly, the annual rate stays in
                  effect until your renewal date.
                </p>
              </details>
              <details>
                <summary>Can I use my own Gmail account, or do I need a new one?</summary>
                <p className="a">
                  Use your own. We connect via OAuth to the Gmail you already have. We never see
                  your password and we never store the contents of any message.
                </p>
              </details>
              <details>
                <summary>Why is Team priced per user when one person could share a login?</summary>
                <p className="a">
                  Because a shared login defeats the activity log. The whole point of Team is
                  per-seat accountability — who archived what, who created which rule, whose
                  override changed a category. Per-user pricing is the honest shape.
                </p>
              </details>
              <details>
                <summary>Do you train AI on my email?</summary>
                <p className="a">
                  No. We never send your message contents to any AI — ours or anyone else’s. Our
                  shared memory contains patterns about senders only (&ldquo;LinkedIn is a
                  newsletter&rdquo;), never about you. See the{" "}
                  <Link to="/privacy" className="btn-link" style={{ fontSize: 13 }}>
                    eight hard rules
                  </Link>{" "}
                  for the detailed answer.
                </p>
              </details>
              <details>
                <summary>What if I have 250,000 emails?</summary>
                <p className="a">
                  Pro and Pro Pass both handle it. The first scan runs server-side, takes about ten
                  minutes for that volume, and tells you what it found. You close the tab and we
                  email you when it’s done. The post-scan view shows you the four shortcuts that
                  clear the most inbox per click.
                </p>
              </details>
              <details>
                <summary>
                  Can I get a discount for nonprofits / students / open-source maintainers?
                </summary>
                <p className="a">
                  Yes, 50% off Pro for any of the three. Send a one-line email from your
                  .org/.edu/maintainer address; no application form.
                </p>
              </details>
            </div>
          </div>
        </section>

        <div className="asterism container">⁂</div>

        {/* Conversion banner */}
        <section className="conv" id="cta">
          <div className="container inner">
            <h2 className="display">
              Try it free — <em>your inbox stays private.</em>
            </h2>
            <p>No credit card. No trial countdown. Ten cleanup actions, on us, forever.</p>
            <Link to="/sign-in" className="btn btn-primary">
              Clean my inbox →
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="container">
          <div className="row">
            <div>
              <div className="tagline">
                DeclutrMail — the <em>calm cleanup</em> for the inbox you stopped opening.
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "hsl(var(--muted-foreground))",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                We see who. We don’t see what. Seven days to undo anything.
              </p>
            </div>
            <div>
              <h5>Product</h5>
              <ul>
                <li>
                  <Link to="/how-it-works">How it works</Link>
                </li>
                <li>
                  <Link to="/pricing">Pricing</Link>
                </li>
                <li>
                  <Link to="/compare">Compare</Link>
                </li>
              </ul>
            </div>
            <div>
              <h5>Privacy</h5>
              <ul>
                <li>
                  <Link to="/privacy">The privacy promise</Link>
                </li>
                <li>
                  <Link to="/privacy#audit">Activity log</Link>
                </li>
                <li>
                  <Link to="/privacy#rules">The eight hard rules</Link>
                </li>
              </ul>
            </div>
            <div>
              <h5>Company</h5>
              <ul>
                <li>
                  <Link to="/blog">Blog</Link>
                </li>
                <li>
                  <Link to="/contact">Contact</Link>
                </li>
                <li>
                  <Link to="/terms">Terms</Link>
                </li>
                <li>
                  <Link to="/privacy-policy">Privacy policy</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="colophon">
            <span>© 2026 DeclutrMail</span>
            <span>We never read your email.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
