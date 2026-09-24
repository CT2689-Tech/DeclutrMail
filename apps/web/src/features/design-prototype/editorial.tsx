'use client';

import { useRef } from 'react';
import type { PrototypeProps, SampleSender } from './fixture';
import { Icon, BrandMark, SenderAvatar, Sparkline } from './prototype-ui';
import s from './editorial.module.css';
import { SenderWorkspaceControls } from './sender-workspace';

export function EditorialPrototype(p: PrototypeProps) {
  const detailRef = useRef<HTMLElement>(null);
  const { search, setSearch, selection, toggleSelected, filtered } = p.workspace;
  const info = (name: string) =>
    p.showInfo(
      name,
      'This screen is part of the proposed navigation. Explore Overview and Clean up in this interactive design prototype.',
    );
  const sender = p.selected;
  const firstSender = p.senders[0] ?? p.selected;
  const protectedSender = p.senders.find((item) => item.protected) ?? firstSender;
  const open = (x: SampleSender) => {
    p.selectSender(x.id);
    if (p.view !== 'senders') p.navigate('senders');
    if (p.view === 'senders' && window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          detailRef.current?.scrollIntoView({
            behavior: reduced ? 'instant' : 'smooth',
            block: 'start',
          });
        });
      });
    }
  };
  const primary = (label: string, fn: () => void) => (
    <button className={s.primary} onClick={fn}>
      {label}
      <Icon name="arrow" size={17} />
    </button>
  );
  const senderRows = (short = false) => (
    <div className={s.rows}>
      {(short ? p.senders.slice(0, 3) : filtered).map((x) => (
        <div key={x.id} className={s.selectableRow}>
          {!short && (
            <input
              type="checkbox"
              aria-label={`Select ${x.name}`}
              checked={selection.includes(x.id)}
              onChange={() => toggleSelected(x.id)}
            />
          )}
          <button
            aria-pressed={!short && sender.id === x.id}
            className={`${s.senderRow} ${!short && sender.id === x.id ? s.selected : ''}`}
            onClick={() => open(x)}
          >
            <SenderAvatar sender={x} size={42} />
            <span className={s.senderIdentity}>
              <strong>
                {x.name} {x.protected && <Icon name="shield" size={12} />}
              </strong>
              <small>{short ? `${x.markedRead}% marked read · last 90 days` : x.email}</small>
            </span>
            <span className={s.rowCount}>
              {x.inbox}
              <small>in inbox</small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      ))}
      {!short && filtered.length === 0 && (
        <p className={s.noResults}>No senders match. Try another search or view.</p>
      )}
    </div>
  );
  const miniProduct = (
    <div className={s.productWindow}>
      <div className={s.windowTop}>
        <BrandMark />
        <span>DECLUTRMAIL</span>
        <span className={s.windowLabel}>A little room to breathe.</span>
      </div>
      <div className={s.windowBody}>
        <div className={s.miniSidebar}>
          <Icon name="home" />
          <Icon name="senders" />
          <Icon name="automation" />
          <Icon name="activity" />
        </div>
        <div className={s.miniList}>
          <span className={s.eyebrow}>YOUR INBOX, BY SENDER</span>
          <h3>See the bigger picture.</h3>
          {senderRows(true)}
          <p className={s.miniFoot}>
            <Icon name="shield" size={14} />
            You choose what stays. Always.
          </p>
        </div>
        <div className={s.miniDetail}>
          <SenderAvatar sender={firstSender} size={50} />
          <h3>Fieldnotes</h3>
          <p>
            Good reading.
            <br />A little too much of it.
          </p>
          <div className={s.miniNumber}>
            {firstSender.inbox}
            <span>emails in your inbox</span>
          </div>
          <Sparkline values={firstSender.trend} />
          {primary('Review sender', () => open(firstSender))}
        </div>
      </div>
    </div>
  );
  if (p.view === 'website')
    return (
      <div className={`${s.root} ${s.website}`} data-theme={p.theme}>
        <nav className={s.siteNav} aria-label="Website">
          <button className={s.siteBrand} onClick={() => p.navigate('website')}>
            <BrandMark />
            DeclutrMail<span>ROOM FOR WHAT MATTERS</span>
          </button>
          <div>
            <button
              onClick={() =>
                document.getElementById('editorial-how')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              How it works
            </button>
            <button
              onClick={() =>
                p.showInfo(
                  'Privacy by design',
                  'This prototype uses only fictional sender data. DeclutrMail’s product design keeps permission, protection and action previews visible at the point of decision.',
                )
              }
            >
              Your privacy
            </button>
            {primary('Explore the demo', () => p.navigate('overview'))}
          </div>
        </nav>
        <main>
          <section className={s.siteHero}>
            <div className={s.heroKicker}>
              <span />A CALMER WAY TO MANAGE EMAIL
            </div>
            <h1>
              Your inbox.
              <br />
              With room to <em>breathe.</em>
            </h1>
            <p>
              The newsletters, the updates, the things you meant to read.
              <br className={s.desktopBreak} /> Make space for what matters, one sender at a time.
            </p>
            <div className={s.heroActions}>
              {primary('Find your fresh start', () => p.navigate('senders'))}
              <button className={s.textButton} onClick={() => p.navigate('overview')}>
                Take a look inside <Icon name="arrow" size={16} />
              </button>
            </div>
            <div className={s.heroNote}>
              Preview every change <span>·</span> Keep the final say
            </div>
            <div className={s.productStage}>
              <span className={s.stageAnnotation}>
                Less sorting.
                <br />
                More living.
              </span>
              {miniProduct}
              <div className={s.stageCaption}>
                <span>01 / A CLEARER PERSPECTIVE</span>
                <span>Illustrative demo · fictional inbox</span>
              </div>
            </div>
          </section>
          <section className={s.promiseStrip}>
            <span>Made for the inbox you actually have.</span>
            <span>Thoughtful decisions.</span>
            <span>Clear previews.</span>
            <span>A way back.</span>
          </section>
          <section id="editorial-how" className={s.howSection}>
            <div>
              <span className={s.eyebrow}>LESS BUSYWORK. MORE INTENTION.</span>
              <h2>
                A fresh start,
                <br />
                without starting over.
              </h2>
            </div>
            <div className={s.steps}>
              {[
                {
                  title: 'See who fills your inbox.',
                  body: 'Bring scattered email together by sender. Understand volume and recent activity before deciding what deserves your attention.',
                },
                {
                  title: 'Make one thoughtful decision.',
                  body: 'Keep the senders you value. Review the rest with a clear preview of the emails your action will affect.',
                },
                {
                  title: 'Know where things stand.',
                  body: 'Follow the result in Activity. Return to supported actions while their Undo window is open.',
                },
              ].map((x, i) => (
                <div key={x.title}>
                  <span className={s.stepNumber}>0{i + 1}</span>
                  <div>
                    <h3>{x.title}</h3>
                    <p>{x.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className={s.siteFeature}>
            <div className={s.featureQuote}>
              <span className={s.eyebrow}>YOU’RE IN CONTROL</span>
              <h2>
                Clear the clutter.
                <br />
                <em>Keep the good.</em>
              </h2>
              <p>
                A bank alert is not a forgotten newsletter. Protect senders that matter and see
                exactly what a cleanup will do before you confirm.
              </p>
              <button
                className={s.lightLink}
                onClick={() => open(p.senders.find((x) => x.protected) ?? firstSender)}
              >
                Explore sender protection <Icon name="arrow" size={16} />
              </button>
            </div>
            <div className={s.protectionCard}>
              <div className={s.protectionTop}>
                <Icon name="shield" size={25} />
                <span>PROTECTED BY YOU</span>
              </div>
              <SenderAvatar sender={protectedSender} size={58} />
              <h3>Northbank</h3>
              <p>
                The important things
                <br />
                deserve their own place.
              </p>
              <div>
                <Icon name="check" size={16} />
                Excluded from bulk cleanup
              </div>
              <div>
                <Icon name="check" size={16} />
                Excluded from automation
              </div>
            </div>
          </section>
          <section className={s.siteClosing}>
            <span className={s.eyebrow}>A LITTLE LESS EMAIL. A LITTLE MORE SPACE.</span>
            <h2>Meet your calmer inbox.</h2>
            {primary('Try the interactive demo', () => p.navigate('senders'))}
            <p>Fictional data. Real product ideas. No Gmail connection.</p>
          </section>
        </main>
        <footer className={s.siteFooter}>
          <div>
            <BrandMark />
            DeclutrMail
          </div>
          <span>Make room for what matters.</span>
          <button onClick={() => p.navigate('overview')}>
            Explore the product <Icon name="arrow" size={14} />
          </button>
        </footer>
      </div>
    );
  return (
    <div className={s.root} data-theme={p.theme}>
      <div className={s.app}>
        <aside className={s.iconRail} aria-label="Workspace navigation">
          <button
            className={s.railBrand}
            aria-label="DeclutrMail overview"
            onClick={() => p.navigate('overview')}
          >
            <BrandMark />
          </button>
          <nav aria-label="Product navigation">
            {(
              [
                { id: 'overview', label: 'Overview', icon: 'home' },
                { id: 'senders', label: 'Clean up', icon: 'senders' },
                { id: 'automations', label: 'Automations', icon: 'automation' },
                { id: 'catchup', label: 'Catch up', icon: 'catchup' },
                { id: 'activity', label: 'Activity', icon: 'activity' },
              ] as const
            ).map((x) => (
              <button
                key={x.id}
                aria-label={x.label}
                aria-current={p.view === x.id ? 'page' : undefined}
                onClick={() =>
                  x.id === 'overview' || x.id === 'senders' ? p.navigate(x.id) : info(x.label)
                }
              >
                <Icon name={x.icon} size={20} />
                <span className={s.railLabel}>{x.label}</span>
              </button>
            ))}
          </nav>
          <button
            className={s.railAccount}
            aria-label="Workspace settings"
            onClick={() => info('Workspace settings')}
          >
            JL<span className={s.railLabel}>Workspace settings</span>
          </button>
        </aside>
        <div className={s.appMain}>
          <header className={s.topbar}>
            <span>
              YOUR PERSONAL SPACE <span className={s.topbarSlash}>/</span>{' '}
              {p.view === 'overview' ? 'OVERVIEW' : 'CLEAN UP'}
            </span>
            <div>
              <span className={s.demoPill}>DEMO INBOX</span>
              <button onClick={() => p.navigate('website')}>
                Visit website <Icon name="external" size={13} />
              </button>
            </div>
          </header>
          {p.view === 'overview' ? (
            <main className={s.overview}>
              <div className={s.pageHeading}>
                <div>
                  <span className={s.eyebrow}>MONDAY, SEPTEMBER 21</span>
                  <h1>
                    A little room
                    <br />
                    for a <em>clearer day.</em>
                  </h1>
                  <p>
                    Your inbox has a few things you can let go of.
                    <br />
                    Let’s start with the easy ones.
                  </p>
                </div>
                <div className={s.greetingStamp}>
                  <span>
                    THE SPACE
                    <br />
                    YOU’VE MADE
                  </span>
                  <strong>{p.cleared.toLocaleString('en-US')}</strong>
                  <span>emails cleared</span>
                  <div className={s.stampLine} />
                  <small>Illustrative all-time progress</small>
                </div>
              </div>
              <section className={s.opportunity}>
                <div className={s.opportunityText}>
                  <span className={s.eyebrow}>A GOOD PLACE TO START</span>
                  <h2>
                    Good reads.
                    <br />A growing backlog.
                  </h2>
                  <p>
                    Three senders account for{' '}
                    {p.senders.slice(0, 3).reduce((sum, item) => sum + item.inbox, 0)} emails in
                    this example inbox. Take a look and decide what still belongs.
                  </p>
                  {primary('Review these senders', () => open(firstSender))}
                  <span className={s.safeNote}>
                    <Icon name="shield" size={13} />
                    Nothing changes until you confirm.
                  </span>
                </div>
                <div className={s.opportunityList}>
                  <div className={s.listLabel}>
                    <span>SENDER</span>
                    <span>IN YOUR INBOX</span>
                  </div>
                  {senderRows(true)}
                  <div className={s.listFooter}>
                    Based on inbox volume and recent marked-read activity.
                  </div>
                </div>
              </section>
              <section className={s.overviewLower}>
                <div className={s.attention}>
                  <div className={s.sectionHeading}>
                    <h2>A little attention.</h2>
                    <span>THEN BACK TO YOUR DAY</span>
                  </div>
                  <button onClick={() => info('New senders')}>
                    <div className={s.attentionIcon}>
                      <Icon name="mail" />
                    </div>
                    <span>
                      <strong>3 new faces in your inbox</strong>
                      <small>Review unfamiliar senders on your terms.</small>
                    </span>
                    <Icon name="arrow" size={18} />
                  </button>
                  <button onClick={() => info('Automation suggestions')}>
                    <div className={s.attentionIcon}>
                      <Icon name="automation" />
                    </div>
                    <span>
                      <strong>Your rules have suggestions</strong>
                      <small>See what’s ready for your review.</small>
                    </span>
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
                <div className={s.progressNote}>
                  <span className={s.eyebrow}>SMALL DECISIONS ADD UP</span>
                  <h3>
                    More space.
                    <br />
                    Less second-guessing.
                  </h3>
                  <p>
                    {p.lastResult ??
                      'Your cleanup history keeps every outcome in view, with Undo available for supported actions.'}
                  </p>
                  <button className={s.textButton} onClick={() => info('Activity')}>
                    See your activity <Icon name="arrow" size={15} />
                  </button>
                </div>
              </section>
              <div className={s.pageFoot}>
                A considered inbox, one decision at a time.
                <span>All data in this prototype is fictional.</span>
              </div>
            </main>
          ) : (
            <main className={s.cleanup}>
              <div className={s.cleanupHeading}>
                <div>
                  <span className={s.eyebrow}>A CLEARER PERSPECTIVE</span>
                  <h1>
                    Senders<span className={s.headingAccent}> / Make room.</span>
                  </h1>
                  <p>A clear view of who sends what. Keep what matters; review the rest.</p>
                </div>
                <span className={s.senderTotal}>
                  <strong>{p.senders.length}</strong>senders in this demo
                </span>
              </div>
              <div className={`${s.cleanupGrid} ${p.fullDetails ? s.fullDetailGrid : ''}`}>
                {!p.fullDetails && (
                  <section className={s.senderPanel}>
                    <div className={s.workspaceLabel}>
                      <span>YOUR SENDERS</span>
                      <span>{p.senders.length} in this mailbox</span>
                    </div>
                    <div className={s.search}>
                      <Icon name="search" size={17} />
                      <input
                        aria-label="Search senders"
                        placeholder="Find a sender…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button aria-label="Clear search" onClick={() => setSearch('')}>
                          <Icon name="close" size={15} />
                        </button>
                      )}
                    </div>
                    <SenderWorkspaceControls p={p} styles={s} />
                    {senderRows()}
                    <div className={s.listFooter}>
                      {filtered.length} senders · fictional inbox data
                    </div>
                  </section>
                )}
                <section
                  ref={detailRef}
                  className={s.detail}
                  aria-label={`${sender.name} sender details`}
                >
                  <div className={s.detailTop}>
                    <span className={s.eyebrow}>
                      {p.fullDetails ? 'FULL SENDER DETAILS' : 'SENDER DETAILS'}
                    </span>
                    <button
                      aria-label={
                        p.fullDetails ? 'Back to sender list' : 'Open full sender details'
                      }
                      onClick={p.openFullDetails}
                    >
                      <Icon name={p.fullDetails ? 'close' : 'external'} size={17} />
                    </button>
                  </div>
                  <div className={s.detailIdentity}>
                    <SenderAvatar sender={sender} size={60} />
                    <div>
                      <h2>{sender.name}</h2>
                      <span>{sender.email}</span>
                    </div>
                  </div>
                  <div
                    className={s.detailBody}
                    tabIndex={0}
                    role="region"
                    aria-label="Sender evidence and recent emails"
                  >
                    <div className={s.detailMetrics}>
                      <div>
                        <strong>{sender.inbox}</strong>
                        <span>in your inbox</span>
                      </div>
                      <div>
                        <strong>
                          {sender.markedRead}
                          <small>%</small>
                        </strong>
                        <span>marked read · 90 days</span>
                      </div>
                    </div>
                    {p.fullDetails && (
                      <div className={s.fullContext}>
                        <div>
                          <span>ALL EMAILS</span>
                          <strong>{sender.total}</strong>
                        </div>
                        <div>
                          <span>FIRST SEEN</span>
                          <strong>{sender.firstSeen}</strong>
                        </div>
                        <div>
                          <span>MOST RECENT</span>
                          <strong>{sender.lastSeen}</strong>
                        </div>
                      </div>
                    )}
                    <div className={s.chart}>
                      <div>
                        <span>EMAIL RECEIVED</span>
                        <span>LAST 12 WEEKS</span>
                      </div>
                      <Sparkline values={sender.trend} />
                    </div>
                    <div className={s.insight}>
                      <span>{sender.protected ? 'YOUR CHOICE, RESPECTED' : 'WORTH A LOOK'}</span>
                      <p>
                        {sender.protected
                          ? 'You’ve protected this sender. It is excluded from bulk cleanup and automation.'
                          : `${sender.inbox} emails in your inbox. ${sender.markedRead}% marked read in the last 90 days. Review before choosing what to keep.`}
                      </p>
                    </div>
                    <div className={s.messageHeader}>
                      <h3>Recent email</h3>
                      <span>FICTIONAL SAMPLES</span>
                    </div>
                    <div className={s.messages}>
                      {sender.messages.map((m) => (
                        <button
                          key={m.subject}
                          onClick={() =>
                            p.showInfo(
                              m.subject,
                              `${m.snippet} This is a fictional message sample for the design prototype.`,
                            )
                          }
                        >
                          <Icon name="mail" size={15} />
                          <span>{m.subject}</span>
                          <small>{m.date}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={s.actionArea}>
                    <div>
                      <span>FOR THIS SENDER</span>
                      <small>Review scope before confirming</small>
                    </div>
                    <div className={s.mainActions}>
                      {primary(`Archive ${sender.inbox} emails`, () => p.previewAction('Archive'))}
                      <button className={s.secondary} onClick={() => p.previewAction('Keep')}>
                        <Icon name="check" size={16} />
                        Keep
                      </button>
                    </div>
                    <div className={s.moreActions}>
                      <button onClick={() => p.previewAction('Unsubscribe')}>Unsubscribe</button>
                      <button onClick={() => p.previewAction('Later')}>Later</button>
                      <button onClick={() => p.previewAction('Delete')}>Delete</button>
                      <button onClick={p.toggleProtection}>
                        <Icon name="shield" size={12} />
                        {sender.protected ? 'Protected' : 'Protect sender'}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
              <div className={s.pageFoot}>
                You choose what stays.<span>Preview every change. Keep the final say.</span>
              </div>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
