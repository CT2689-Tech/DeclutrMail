import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./Landing.css";

/**
 * Landing — DeclutrMail's marketing home.
 *
 * Source: /tmp/declutr-design-bd3l/.../marketing/index.html (canonical
 * 603 lines). Translated to JSX 1:1 — same class names, same DOM
 * structure, same content. CSS is split between:
 *   - Marketing-shared classes in src/index.css (.nav, .hero, .btn,
 *     .eyebrow, .pill, .stat-strip, .steps3, .conv, .site-footer, etc.)
 *   - Landing-specific classes in ./Landing.css (.faq-grid, .faq-q,
 *     .preview-card animation states)
 *
 * Internal links use React Router <Link>. External links use plain <a>
 * with rel="noopener". Hash links (#main, #how, #faq, #q*) stay as <a>.
 *
 * The hero preview-card runs an auto-demo loop (archive → undo) via
 * useEffect, ported from the canonical's inline <script>. Respects
 * prefers-reduced-motion.
 */
export default function Landing() {
  const previewRef = useHeroPreviewAnimation();

  return (
    <>
      <Helmet>
        <title>DeclutrMail — Clean up the Gmail you stopped opening</title>
        <meta
          name="description"
          content="The Gmail cleanup tool that never reads your email. Group years of clutter by sender, archive in bulk, change your mind for seven days."
        />
      </Helmet>

      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Trust strip */}
      <div className="container">
        <div className="trust-strip">
          <div className="left">
            <span>
              <span className="dot" />
              Nothing gets deleted
            </span>
            <span>Change your mind for 7 days</span>
            <span>We never read what’s inside</span>
          </div>
          <div className="right">
            <a href="#how">
              How it works{" "}
              <span className="kbd" aria-hidden="true">
                ↓
              </span>
            </a>
            <Link to="/how-it-works">Architecture</Link>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="container">
        <nav className="nav" aria-label="Primary">
          <Link className="brand" to="/" aria-label="DeclutrMail home">
            <span className="mark">
              D<em>·</em>
            </span>
            <span className="word">
              Declutr<em>Mail</em>
            </span>
          </Link>
          <div className="links">
            <Link to="/" className="active" aria-current="page">
              Product
            </Link>
            <Link to="/how-it-works">How it works</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/compare">Compare</Link>
            <Link to="/privacy">Privacy</Link>
            <Link className="cta" to="/sign-in">
              Sign in
            </Link>
          </div>
        </nav>
      </div>

      <main id="main">
        {/* Hero — 2-column grid: editorial copy left, tilted preview right.
            Mobile collapses to stacked via .hero-grid breakpoint. */}
        <section className="hero">
          <div className="container">
            <div className="hero-grid">
              <div className="hero-copy">
                <div className="eyebrow">— For inboxes you’ve stopped opening —</div>
                <h1>
                  Tens of thousands unread? <em>It’s okay. We can help.</em>
                </h1>
                <p className="deck">
                  You know that little number next to Gmail you’ve been avoiding? Connect us, and in
                  five minutes we’ll show you the handful of senders responsible for most of it. You
                  decide who stays. Anything you regret, you’ve got a week to undo.
                </p>

                <div className="actions">
                  <Link to="/sign-in" className="btn btn-primary">
                    Help me clean it up →
                  </Link>
                  <a href="#how" className="btn-link">
                    See how it works
                  </a>
                </div>
              </div>

              {/* Animated product preview — tilted, off-grid bleed on desktop */}
              <div className="hero-preview-wrap">
                <div className="preview-card" ref={previewRef}>
                  <div className="preview-bar">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                    <span>12 senders · 119 messages this week</span>
                    <span className="label">DeclutrMail · Cleanup view</span>
                  </div>

                  <div className="preview-row" data-row="linkedin">
                    <span className="av" style={{ background: "#DC2626" }}>
                      L
                      <img
                        src="https://www.google.com/s2/favicons?domain=linkedin.com&sz=64"
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <div className="who">
                      <div className="n">LinkedIn</div>
                      <div className="meta">
                        <span className="dom">linkedin.com</span>
                        <span className="pill red">You’ve opened 0</span>
                        <span>Daily</span>
                      </div>
                    </div>
                    <div className="cnt">
                      47/wk · <b>1,847 total</b>
                    </div>
                    <div className="verbs">
                      <span className="v archive" title="Archive">
                        A
                      </span>
                      <span className="v mute" title="Mute">
                        M
                      </span>
                      <span className="v unsub" title="Unsubscribe">
                        U
                      </span>
                      <span className="v keep" title="Keep">
                        K
                      </span>
                    </div>
                  </div>

                  <div
                    className="preview-row spike"
                    data-row="groupon"
                    style={{ background: "rgba(245,158,11,.04)" }}
                  >
                    <span className="av" style={{ background: "#B45309" }}>
                      G
                      <img
                        src="https://www.google.com/s2/favicons?domain=groupon.com&sz=64"
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <div className="who">
                      <div className="n">Groupon</div>
                      <div className="meta">
                        <span className="dom">groupon.com</span>
                        <span className="pill amber">Sending 3× more lately</span>
                        <span>Daily</span>
                      </div>
                    </div>
                    <div className="cnt">
                      12/wk · <b>422 total</b>
                    </div>
                    <div className="verbs">
                      <span className="v archive">A</span>
                      <span className="v mute">M</span>
                      <span className="v unsub">U</span>
                      <span className="v keep">K</span>
                    </div>
                  </div>

                  <div className="preview-row" data-row="substack">
                    <span className="av" style={{ background: "#FF6719" }}>
                      S
                      <img
                        src="https://www.google.com/s2/favicons?domain=substack.com&sz=64"
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <div className="who">
                      <div className="n">Letters of Note · Substack</div>
                      <div className="meta">
                        <span className="dom">substack.com</span>
                        <span className="pill emerald">You open 86% of these</span>
                        <span>Weekly</span>
                      </div>
                    </div>
                    <div className="cnt">
                      7/wk · <b>142 total</b>
                    </div>
                    <div className="verbs">
                      <span className="v archive">A</span>
                      <span className="v mute">M</span>
                      <span className="v unsub">U</span>
                      <span
                        className="v keep"
                        style={{
                          background: "hsl(var(--success-strong))",
                          color: "#fff",
                          borderColor: "hsl(var(--success-strong))",
                        }}
                      >
                        K
                      </span>
                    </div>
                  </div>

                  <div className="preview-undo-toast" id="preview-undo-toast" aria-hidden="true">
                    <span className="label">
                      Archived <b>422 messages from Groupon</b>
                    </span>
                    <span className="undo">Undo · Z</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stat strip */}
        <div className="container" style={{ marginBottom: 56 }}>
          <div className="stat-strip">
            <div className="cell">
              <div className="n">~5 min</div>
              <div className="l">Most people are done in</div>
            </div>
            <div className="cell">
              <div className="n">7 days</div>
              <div className="l">To change your mind</div>
            </div>
            <div className="cell">
              <div className="n">0 bytes</div>
              <div className="l">Of your messages, ever read</div>
            </div>
            <div className="cell">
              <div className="n">Free</div>
              <div className="l">Up to ten cleanups, no card</div>
            </div>
          </div>
        </div>

        {/* 3 steps */}
        <section className="section alt" id="how">
          <div className="container">
            <div className="eyebrow primary" style={{ marginBottom: 14 }}>
              — How it works —
            </div>
            <h2>Three calm steps.</h2>
            <p className="sub">
              No setup. No filters to write. You stay in Gmail. We just help you see what’s there.
            </p>

            <div className="steps3">
              <div className="step">
                <div className="n">Step 01</div>
                <h3>Connect your Gmail</h3>
                <p>One click. We can only look — never send, never delete, never change a thing.</p>
              </div>
              <div className="step">
                <div className="n">Step 02</div>
                <h3>Meet the dozen culprits</h3>
                <p>
                  We sort your inbox by who sent each email. In two minutes, you’ll see the handful
                  of senders behind most of the clutter. Usually the same suspects.
                </p>
              </div>
              <div className="step">
                <div className="n">Step 03</div>
                <h3>Tidy it your way</h3>
                <p>
                  Archive in bulk. Unsubscribe in one click. Keep what matters. Regret a choice?
                  You’ve got a week to take it back.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy soft pitch */}
        <section className="section">
          <div className="container">
            <div className="eyebrow primary" style={{ marginBottom: 14 }}>
              — The privacy thing, plainly —
            </div>
            <h2>
              How do we do this <em>without reading your email?</em>
            </h2>
            <p className="sub">
              Short answer: we look at who sent each message, not what they say.
            </p>

            <div className="twoup">
              <div>
                <p className="editorial-dropcap">
                  Most of your senders, we already recognize. A million inboxes before yours have
                  helped us identify LinkedIn, Substack, that airline you flew once.
                </p>
                <p>
                  For the rare new sender, we ask an AI model the simplest possible question — who
                  is this? Just the name and the subject line. Nothing else.
                </p>
              </div>
              <div>
                <p>
                  Everything we do shows up in a log you can open on day one. Time-stamped, named,
                  reversible for a week.
                </p>
                <p>
                  We didn’t add the log to look good. It’s the foundation. If you can’t verify what
                  we won’t do, it isn’t really a promise.{" "}
                  <Link className="btn-link" to="/how-it-works">
                    How it works →
                  </Link>{" "}
                  ·{" "}
                  <Link className="btn-link" to="/privacy">
                    Privacy →
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Honest fit */}
        <section className="section alt">
          <div className="container">
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              — Honest fit —
            </div>
            <h2>
              Is this <em>for you?</em>
            </h2>
            <div className="twoup" style={{ marginTop: 24 }}>
              <div>
                <p>
                  <span className="pill primary" style={{ marginBottom: 8 }}>
                    You’ll love this if
                  </span>
                </p>
                <p>
                  You have years of unread email and you’d like that to stop. You like Gmail and
                  don’t want to leave. You don’t need an AI writing your replies — you just want the
                  noise gone.
                </p>
              </div>
              <div>
                <p>
                  <span className="pill amber" style={{ marginBottom: 8 }}>
                    You won’t love this if
                  </span>
                </p>
                <p>
                  You want a tool that writes your replies. That’s not us. Try{" "}
                  <a
                    className="btn-link"
                    href="https://superhuman.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Superhuman
                  </a>{" "}
                  or{" "}
                  <a
                    className="btn-link"
                    href="https://shortwave.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Shortwave
                  </a>{" "}
                  — they’re great at that.{" "}
                  <Link className="btn-link" to="/compare">
                    Side-by-side →
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pull quote — editorial breathing-point between sections.
            One italic accent on the actual differentiator (architecture
            vs. promise). Earns its weight per the design gotcha. */}
        <section style={{ padding: "16px 0 16px" }}>
          <div className="container">
            <blockquote className="pullquote">
              <q>
                The architecture forbids reading your email.{" "}
                <em>The promise is just architecture you can verify.</em>
              </q>
              <span className="attr">— Our oath, since day one</span>
            </blockquote>
          </div>
        </section>

        {/* Log preview · dark visual-rhythm break */}
        <section
          style={{
            background: "#0F1413",
            color: "#F0EEE9",
            padding: "80px 0",
            borderTop: "1px solid rgba(255,255,255,.08)",
            borderBottom: "1px solid rgba(255,255,255,.08)",
          }}
        >
          <div className="container">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.4fr",
                gap: 48,
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: ".22em",
                    textTransform: "uppercase",
                    color: "#79E6DC",
                    marginBottom: 14,
                  }}
                >
                  — Every action, written down —
                </div>
                <h2
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    fontSize: "clamp(28px, 3.4vw, 40px)",
                    lineHeight: 1.16,
                    letterSpacing: "-0.018em",
                    margin: "0 0 18px",
                    color: "#F0EEE9",
                    paddingBottom: ".1em",
                  }}
                >
                  The log is the{" "}
                  <em
                    style={{
                      fontStyle: "italic",
                      fontVariationSettings: '"opsz" 144,"SOFT" 100,"WONK" 0',
                      color: "#79E6DC",
                    }}
                  >
                    source of truth.
                  </em>
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 16,
                    lineHeight: 1.6,
                    color: "rgba(240,238,233,.78)",
                    margin: "0 0 18px",
                  }}
                >
                  Every cleanup. Every classification. Every time we ask an AI model who someone is.
                  All logged, before it happens. So you can check our work.
                </p>
                <Link
                  to="/privacy#audit"
                  className="btn-link"
                  style={{
                    color: "#79E6DC",
                    borderBottom: "1px solid rgba(121,230,220,.5)",
                    paddingBottom: 2,
                  }}
                >
                  See a real log →
                </Link>
              </div>
              <div
                style={{
                  background: "#1A2120",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "12px 18px",
                    background: "#000",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Activity · last 30 days</span>
                  <span style={{ color: "#79E6DC" }}>✓ Sender-only verified</span>
                </div>
                <LogRow time="10:48" actor="You" actorColor="#79E6DC">
                  Reclassified marcus@vendor-news.io — Newsletter → Person
                </LogRow>
                <LogRow time="10:31" actor="DeclutrMail" tag="Sender only" tagTone="emerald">
                  Classified pinterest.com as Newsletter (recognized)
                </LogRow>
                <LogRow time="10:31" actor="DeclutrMail" tag="AI lookup" tagTone="amber">
                  Classified hndigest.com as Newsletter (AI lookup)
                </LogRow>
                <div
                  style={{
                    padding: "14px 18px",
                    background: "rgba(0,122,110,.18)",
                    borderTop: "1px solid rgba(121,230,220,.2)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "rgba(240,238,233,.85)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: "#79E6DC",
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                  >
                    — Today’s receipt —
                  </div>
                  <span style={{ color: "#F0EEE9", fontWeight: 700 }}>2,418</span> messages looked
                  at · <span style={{ color: "#F0EEE9", fontWeight: 700 }}>41</span> AI lookups
                  (who-sent-it only) · <span style={{ color: "#F0EEE9", fontWeight: 700 }}>0</span>{" "}
                  messages read, ever
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq">
          <div className="container">
            <div className="faq-grid">
              <aside className="faq-aside">
                <div className="eyebrow primary">— Common questions —</div>
                <h2>
                  The first five things <em>people ask.</em>
                </h2>
                <p>
                  Every answer here is something you can verify in your account, or in our
                  architecture page. No marketing detours.
                </p>
                <nav className="index" aria-label="Question index">
                  {FAQ_INDEX.map(({ q, label }) => (
                    <a key={q} href={`#${q}`}>
                      <span className="num">Q.{q.slice(1).padStart(2, "0")}</span>
                      <span>{label}</span>
                      <span className="arr">→</span>
                    </a>
                  ))}
                </nav>
              </aside>

              <div>
                <div className="faq-list">
                  {FAQ_ITEMS.map((item, i) => (
                    <FaqItem key={item.id} index={i + 1} item={item} />
                  ))}
                </div>

                <div className="faq-footnote">
                  <span>— Didn’t find your question? —</span>
                  <Link to="/contact">Ask us →</Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Conversion banner */}
        <section className="conv">
          <div className="container inner">
            <h2>
              Try it free. <em>Your inbox stays yours.</em>
            </h2>
            <p>No credit card. No countdown. Ten cleanups on the free tier — yours, forever.</p>
            <Link to="/sign-in" className="btn btn-primary">
              Help me clean it up →
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
                  fontSize: 13,
                  color: "hsl(var(--muted-foreground))",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                We see who sent it. We don’t see what’s inside. Seven days to undo anything.
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
            <span>Five minutes to clean. Seven days to undo.</span>
          </div>
        </div>
      </footer>
    </>
  );
}

/* ─── Helpers ───────────────────────────────────────────────── */

type LogRowProps = {
  time: string;
  actor: string;
  actorColor?: string;
  tag?: string;
  tagTone?: "emerald" | "amber";
  children: React.ReactNode;
};

function LogRow({ time, actor, actorColor, tag, tagTone, children }: LogRowProps) {
  const tagBg =
    tagTone === "emerald"
      ? "rgba(6,95,70,.4)"
      : tagTone === "amber"
        ? "rgba(146,64,14,.4)"
        : "rgba(255,255,255,.06)";
  const tagFg =
    tagTone === "emerald" ? "#D1FAE5" : tagTone === "amber" ? "#FEF3C7" : "rgba(240,238,233,.5)";
  return (
    <div
      style={{
        padding: "10px 18px",
        display: "grid",
        gridTemplateColumns: "60px 90px 1fr 110px",
        gap: 12,
        alignItems: "center",
        fontSize: 12.5,
        borderBottom: "1px solid rgba(255,255,255,.05)",
      }}
    >
      <span
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "rgba(240,238,233,.5)" }}
      >
        {time}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: actorColor ?? "rgba(240,238,233,.7)",
          fontWeight: 700,
        }}
      >
        {actor}
      </span>
      <span>{children}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 3,
          background: tagBg,
          color: tagFg,
          textAlign: "center",
          fontWeight: tag ? 600 : 400,
        }}
      >
        {tag ?? "—"}
      </span>
    </div>
  );
}

const FAQ_INDEX = [
  { q: "q1", label: "Will I lose anything?" },
  { q: "q2", label: "Change my mind later?" },
  { q: "q3", label: "Privacy — really?" },
  { q: "q4", label: "vs Gmail filters?" },
  { q: "q5", label: "Why no testimonials?" },
];

type FaqItemData = {
  id: string;
  num: string;
  title: React.ReactNode;
  tags: Array<{ label: string; tone?: "emerald" | "amber" | "primary" }>;
  body: React.ReactNode;
  defaultOpen?: boolean;
};

const FAQ_ITEMS: FaqItemData[] = [
  {
    id: "q1",
    num: "Q.01",
    title: (
      <>
        Will I <em>lose</em> anything?
      </>
    ),
    tags: [{ label: "Reversible", tone: "emerald" }, { label: "Undo for 7 days" }],
    body: (
      <>
        Nope. Everything you do is reversible for seven days. Archive moves messages out of your
        inbox — it doesn’t delete them — exactly like Gmail’s own archive button. Unsubscribe stops
        new emails; old ones stay put. Hit <kbd>Z</kbd> mid-cleanup to undo your last move.
      </>
    ),
    defaultOpen: true,
  },
  {
    id: "q2",
    num: "Q.02",
    title: (
      <>
        What if I change my mind <em>later?</em>
      </>
    ),
    tags: [{ label: "Long-term" }, { label: "Rules pause" }],
    body: (
      <>
        Inside the first week, one-click undo from the log. After that, archived messages live in
        Gmail’s normal storage, like anything else you’ve ever archived. Rules can be paused any
        time — no penalty.
      </>
    ),
  },
  {
    id: "q3",
    num: "Q.03",
    title: (
      <>
        Privacy — <em>really?</em>
      </>
    ),
    tags: [{ label: "Privacy", tone: "primary" }, { label: "Verifiable" }],
    body: (
      <>
        Really. We see who sent each email, the subject line, and the short preview Gmail already
        shows in its own list view. <strong>That’s it.</strong> Every action is logged so you can
        verify. <Link to="/privacy">More on this →</Link>
      </>
    ),
  },
  {
    id: "q4",
    num: "Q.04",
    title: (
      <>
        How is this different from <em>Gmail filters?</em>
      </>
    ),
    tags: [{ label: "Retroactive" }, { label: "All-history" }],
    body: (
      <>
        Gmail filters only work on new mail. We work on{" "}
        <strong>everything already in your inbox</strong> — every message from every sender, going
        back years. “Archive everything LinkedIn ever sent me, except recruiter notes” — a few
        seconds for us. Gmail filters can’t do that.
      </>
    ),
  },
  {
    id: "q5",
    num: "Q.05",
    title: (
      <>
        Why no <em>testimonials?</em>
      </>
    ),
    tags: [{ label: "Pre-launch", tone: "amber" }, { label: "Consent only" }],
    body: (
      <>
        We’re pre-launch. Making up testimonials is the kind of trust-shortcut we explicitly don’t
        take. Real ones will go here when our first users let us. Until then, the{" "}
        <Link to="/how-it-works">architecture page</Link> and the{" "}
        <Link to="/privacy#audit">live log</Link> are the real testimonials.
      </>
    ),
  },
];

function FaqItem({ index, item }: { index: number; item: FaqItemData }) {
  return (
    <details className="faq-q" id={item.id} open={item.defaultOpen}>
      <summary>
        <span className="qnum">Q.{String(index).padStart(2, "0")}</span>
        <span className="qtitle">{item.title}</span>
        <span className="qchev" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="faq-body">
        <div className="tags">
          {item.tags.map((t) => (
            <span key={t.label} className={t.tone ? `tag ${t.tone}` : "tag"}>
              {t.label}
            </span>
          ))}
        </div>
        <p className="a">{item.body}</p>
        <span />
      </div>
    </details>
  );
}

/**
 * Auto-demo loop on the hero preview card. Pulses the Groupon archive
 * verb, slides the row out, surfaces the undo toast, then resets and
 * repeats. Pauses when the card scrolls off-screen. Skipped when the
 * user prefers reduced motion.
 */
function useHeroPreviewAnimation() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const card = ref.current;
    if (!card) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const row = card.querySelector<HTMLElement>('[data-row="groupon"]');
    const verb = row?.querySelector<HTMLElement>(".v.archive");
    const toast = card.querySelector<HTMLElement>(".preview-undo-toast");
    if (!row || !verb || !toast) return;

    let active = true;
    const io = new IntersectionObserver((entries) => {
      active = entries[0]!.isIntersecting;
    });
    io.observe(card);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(fn, ms);
      timers.push(t);
      return t;
    };

    const loop = () => {
      after(100, () => {
        if (!active) return after(800, loop) as unknown as void;
        verb.classList.add("is-pressed");
        after(320, () => {
          verb.classList.remove("is-pressed");
          row.classList.add("archiving");
          after(200, () => toast.classList.add("visible"));
          after(2400, () => {
            toast.classList.remove("visible");
            row.classList.remove("archiving");
            after(3200, loop);
          });
        });
      });
    };
    after(2200, loop);

    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return ref;
}
