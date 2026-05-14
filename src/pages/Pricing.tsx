import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { PageMast } from "@/components/brand";

/**
 * Pricing — DeclutrMail's tier comparison page.
 *
 * Source: /tmp/declutr-design-bd3l/.../marketing/pricing.html (230 lines
 * canonical) plus billing.jsx (defines Pro Pass: $12 / 7-day one-time
 * full-Pro pass — the canonical dropped Pro Pass from the tier menu,
 * we keep it because users asked for the trial-pass option).
 *
 * Built against docs/marketing-pages.md:
 *   - Hero h1: .display class (Fraunces); single italic differentiator
 *   - Body text: 17px hero deck (LEAD) + 15px everywhere else (BODY)
 *   - Italic accents: 4 (hero, section-head, conv banner, footer tagline)
 *   - All italic uses WONK 0 + SOFT 100
 *   - PageMast for sticky masthead
 *   - No Roman numerals — match Landing's no-numbered-sections rhythm
 */
export default function Pricing() {
  return (
    <>
      <Helmet>
        <title>Pricing — DeclutrMail</title>
        <meta
          name="description"
          content="Free to start. Pro Pass for a one-time 7-day cleanup. Pro for ongoing automatic cleanups. Teams ship Q3 2026."
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
              automatic cleanups for $9/month. Teams get exportable activity logs and admin
              controls. Cancel any time — your activity log stays in your account for two years
              either way.
            </p>
          </div>
        </section>

        {/* Tiers */}
        <section className="section">
          <div className="container">
            <div className="tiers">
              {/* Free */}
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
                  <li className="off">Nightly automatic cleanups</li>
                  <li className="off">Unlimited cleanup actions</li>
                  <li className="off">Team accounts</li>
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

              {/* Pro Pass — one-time 7-day pass */}
              <div className="tier">
                <h3>Pro Pass</h3>
                <div className="price">
                  $12
                  <small>One-time · 7 days, all Pro features</small>
                </div>
                <p className="desc">
                  For the one-shot cleanup. Buy once, clear the years of clutter, drop back to Free.
                </p>
                <ul>
                  <li>One Gmail account</li>
                  <li>
                    <strong>Unlimited cleanup actions for 7 days</strong>
                  </li>
                  <li>All four actions · Archive, Mute, Unsubscribe, Keep</li>
                  <li>7-day undo on every action</li>
                  <li>Nightly automatic cleanups (while pass is active)</li>
                  <li>Full activity log · export anytime</li>
                  <li>No auto-renew · drops to Free on day 8</li>
                  <li className="off">Recurring nightly cleanups after day 7</li>
                  <li className="off">Priority email support</li>
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

              {/* Pro — featured */}
              <div className="tier featured">
                <span
                  className="eyebrow eyebrow-primary"
                  style={{ display: "block", marginBottom: 6 }}
                >
                  — Most popular —
                </span>
                <h3>Pro</h3>
                <div className="price">
                  $9
                  <small>per month · or $59/year (save $49)</small>
                </div>
                <p className="desc">
                  For the user with eight years of inbox and zero patience for it.
                </p>
                <ul>
                  <li>One Gmail account</li>
                  <li>
                    <strong>Unlimited cleanup actions</strong>
                  </li>
                  <li>All four actions · Archive, Mute, Unsubscribe, Keep</li>
                  <li>7-day undo on every action</li>
                  <li>Plain-English and detailed views on every classification</li>
                  <li>
                    <strong>Nightly automatic cleanups</strong> (per-sender &amp; per-category)
                  </li>
                  <li>Natural-language rule creator (⌘K)</li>
                  <li>Full activity log · export anytime</li>
                  <li>Priority email support · within 24 hours</li>
                </ul>
                <div className="footer">
                  <Link
                    to="/sign-in?plan=pro"
                    className="btn btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Start Pro →
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
                  <li>Everything in Pro</li>
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
                  That’s why our price looks like a cleanup tool ($9/mo) instead of like an AI
                  coworker ($20–40/mo). You’re paying for the cleanup, not the AI calls.
                </p>
              </div>
              <div>
                <p>
                  If you cancel, your account stays read-only for two years. The activity log
                  doesn’t go away. Rules stop firing, but you can come back, verify what we did
                  while you were paying, and export everything.
                </p>
                <p>
                  Refunds within 30 days, no questions. Monthly or annual. If you switch from Free
                  to Pro mid-month, we prorate the next bill.
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
                  $9/month. We’d rather price clearly than dangle a 14-day countdown.
                </p>
              </details>
              <details>
                <summary>What’s the difference between Pro Pass and Pro?</summary>
                <p className="a">
                  Pro Pass is a one-time $12 charge that gives you all Pro features for 7 days, then
                  drops back to Free automatically. No auto-renew, no surprise charge. It’s for the
                  user who has a one-shot mess to clear (years of LinkedIn / Substack / Groupon) and
                  doesn’t want a recurring subscription. Pro is the recurring option for people who
                  want nightly automatic cleanups and unlimited actions forever.
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
