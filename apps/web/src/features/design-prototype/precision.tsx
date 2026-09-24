'use client';

import { useRef } from 'react';
import type { PrototypeProps, SampleSender } from './fixture';
import { Icon, SenderAvatar, Sparkline } from './prototype-ui';
import s from './precision.module.css';
import { SenderWorkspaceControls } from './sender-workspace';

export function PrecisionPrototype(p: PrototypeProps) {
  const { search, setSearch, selection, toggleSelected, filtered: filteredSenders } = p.workspace;
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectSender = (id: string) => {
    p.selectSender(id);
    if (p.view === 'senders' && window.matchMedia('(max-width: 600px)').matches) {
      requestAnimationFrame(() =>
        inspectorRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
          block: 'start',
        }),
      );
    } else if (p.view !== 'senders') {
      p.navigate('senders');
    }
  };
  const info = (title: string, description: string) => p.showInfo(title, description);
  const total = p.senders.reduce((n, sender) => n + sender.inbox, 0);
  const review = () => p.navigate('senders');
  const identity = (
    <span className={s.identity}>
      <span className={s.logo}>
        <Icon name="mail" size={19} />
      </span>
      declutr<span className={s.logoSuffix}>mail</span>
      <span className={s.productTag}>WORKSPACE</span>
    </span>
  );
  const primary = (label: string, fn: () => void = review) => (
    <button className={s.primary} onClick={fn}>
      {label}
      <Icon name="arrow" size={16} />
    </button>
  );
  const senderIdentity = (sender: SampleSender) => (
    <span className={s.senderIdentity}>
      <SenderAvatar sender={sender} size={34} />
      <span>
        <strong>{sender.name}</strong>
        <small>{sender.email}</small>
      </span>
    </span>
  );
  const senderRows = (compact = false) => (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {!compact && <th aria-label="Select sender" />}
            <th>Sender</th>
            <th>In inbox</th>
            <th className={s.optional}>Marked read¹</th>
            <th className={s.optional}>12-week volume</th>
            <th aria-label="View sender" />
          </tr>
        </thead>
        <tbody>
          {(compact ? p.senders.slice(0, 4) : filteredSenders).map((sender) => (
            <tr
              key={sender.id}
              className={p.view === 'senders' && p.selected.id === sender.id ? s.selectedRow : ''}
            >
              {!compact && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${sender.name}`}
                    checked={selection.includes(sender.id)}
                    onChange={() => toggleSelected(sender.id)}
                  />
                </td>
              )}
              <td>
                <button
                  aria-pressed={!compact && p.selected.id === sender.id}
                  className={s.rowLink}
                  onClick={() => inspectSender(sender.id)}
                >
                  {senderIdentity(sender)}
                </button>
              </td>
              <td className={s.number}>
                {sender.inbox}
                <span className={s.bar} style={{ width: `${Math.max(5, sender.inbox / 1.8)}%` }} />
              </td>
              <td className={s.optional}>{sender.markedRead}%</td>
              <td className={s.optional}>
                <Sparkline values={sender.trend} className={s.sparkline ?? ''} />
              </td>
              <td>
                <button
                  className={s.iconButton}
                  aria-label={`Inspect ${sender.name}`}
                  onClick={() => inspectSender(sender.id)}
                >
                  <Icon name={sender.protected ? 'shield' : 'arrow'} size={16} />
                </button>
              </td>
            </tr>
          ))}
          {!compact && filteredSenders.length === 0 && (
            <tr>
              <td colSpan={6}>
                <div className={s.noResults}>
                  No senders match these filters.{' '}
                  <button className={s.textButton} onClick={() => setSearch('')}>
                    Clear search
                  </button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (p.view === 'website')
    return (
      <div className={s.root} data-theme={p.theme}>
        <div className={s.website}>
          <header className={s.publicHeader}>
            <button className={s.brandButton} onClick={() => p.navigate('website')}>
              {identity}
            </button>
            <nav className={s.publicNav}>
              <a href="#precision-product">Product</a>
              <a href="#precision-control">Your control</a>
              <button onClick={review}>
                Explore the demo <Icon name="arrow" size={14} />
              </button>
            </nav>
          </header>
          <main>
            <section className={s.marketingHero}>
              <div className={s.eyebrow}>
                <span className={s.blueDot} /> LESS EMAIL. MORE INTENTION.
              </div>
              <h1>
                Your inbox.
                <br />
                <span>On your terms.</span>
              </h1>
              <div className={s.heroBottom}>
                <p>
                  See what fills your inbox. Clear what you don't need.
                  <br className={s.desktopBreak} /> Make room for the mail that matters.
                </p>
                {primary('Find your focus')}
              </div>
              <div className={s.heroMeta}>
                <span>
                  <Icon name="check" size={13} /> Review before you act
                </span>
                <span>
                  <Icon name="shield" size={13} /> Keep important senders protected
                </span>
                <span>Built for Gmail</span>
              </div>
            </section>
            <section className={s.productDemo} id="precision-product">
              <div className={s.demoChrome}>
                <span className={s.windowDots}>
                  <i />
                  <i />
                  <i />
                </span>
                <span>YOUR INBOX, WITH A CLEARER PICTURE</span>
                <span className={s.demoBadge}>Interactive preview</span>
              </div>
              <div className={s.demoContent}>
                <div className={s.demoTitle}>
                  <div>
                    <span className={s.eyebrow}>A GOOD PLACE TO START</span>
                    <h2>
                      A little review.
                      <br />A lot more room.
                    </h2>
                  </div>
                  <div className={s.demoCount}>
                    <strong>{total}</strong>
                    <span>emails in this sample inbox</span>
                  </div>
                </div>
                {senderRows(true)}
                <div className={s.demoFooter}>
                  <span>Synthetic examples. Your Gmail stays untouched.</span>
                  <button className={s.textButton} onClick={review}>
                    Try the workspace <Icon name="arrow" size={15} />
                  </button>
                </div>
              </div>
            </section>
            <section className={s.promiseSection}>
              <div className={s.sectionKicker}>01 / UNDERSTAND</div>
              <h2>
                A clear view beats
                <br />
                another overflowing inbox.
              </h2>
              <div className={s.threeColumns}>
                <article>
                  <span>01</span>
                  <h3>See the pattern.</h3>
                  <p>
                    Find the senders taking up space, with volume, history and marked-read evidence
                    in one view.
                  </p>
                </article>
                <article>
                  <span>02</span>
                  <h3>Make the call.</h3>
                  <p>
                    Inspect recent mail. Choose what to keep, archive or revisit. See the scope
                    before making a change.
                  </p>
                </article>
                <article>
                  <span>03</span>
                  <h3>Keep it considered.</h3>
                  <p>
                    Preview automation before turning it on. Protect important senders and review
                    what happened.
                  </p>
                </article>
              </div>
            </section>
            <section className={s.controlSection} id="precision-control">
              <div>
                <div className={s.sectionKicker}>02 / STAY IN CONTROL</div>
                <h2>
                  Confidence comes
                  <br />
                  from knowing.
                </h2>
                <p>
                  Every decision deserves a little context. Every change deserves a clear record.
                </p>
                {primary('See how it works')}
              </div>
              <div className={s.controlList}>
                {[
                  [
                    'shield',
                    'Protection with a purpose',
                    'Exclude important senders from bulk cleanup and automatic actions.',
                  ],
                  [
                    'search',
                    'A preview before the change',
                    'Review which mail an action will affect before you confirm.',
                  ],
                  [
                    'activity',
                    'A record you can follow',
                    'See completed actions, pending work and recovery options together.',
                  ],
                ].map(([icon, title, body]) => (
                  <article key={title}>
                    <span className={s.controlIcon}>
                      <Icon name={icon as 'shield' | 'search' | 'activity'} size={20} />
                    </span>
                    <div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section className={s.finalCta}>
              <div className={s.eyebrow}>MAKE SPACE FOR WHAT MATTERS</div>
              <h2>
                Less inbox.
                <br />
                More headspace.
              </h2>
              {primary('Explore DeclutrMail')}
            </section>
          </main>
          <footer className={s.publicFooter}>
            {identity}
            <span>A more considered inbox.</span>
            <span>Design preview · Sample data</span>
          </footer>
        </div>
      </div>
    );

  return (
    <div className={s.root} data-theme={p.theme}>
      <header className={s.appHeader}>
        <button className={s.brandButton} onClick={() => p.navigate('overview')}>
          {identity}
        </button>
        <nav className={s.topNav}>
          <button
            className={p.view === 'overview' ? s.activeNav : ''}
            onClick={() => p.navigate('overview')}
          >
            Overview
          </button>
          <button className={p.view === 'senders' ? s.activeNav : ''} onClick={review}>
            Senders
          </button>
          <button
            onClick={() =>
              info(
                'Automations',
                'Preview rules, review their matches, and choose when to activate them. This design preview focuses on Overview and Senders.',
              )
            }
          >
            Automations
          </button>
          <button
            onClick={() =>
              info(
                'Activity',
                'Completed actions, pending work and recovery options belong together. In this prototype, your simulated actions appear in the Overview ledger.',
              )
            }
          >
            Activity
          </button>
        </nav>
        <button
          className={s.account}
          onClick={() =>
            info(
              'Sample workspace',
              'This is a synthetic inbox used to compare design directions. No Gmail account is connected.',
            )
          }
        >
          <span>JD</span>
          <span>Personal workspace</span>
          <Icon name="chevron" size={12} />
        </button>
      </header>
      <div className={s.appBody}>
        <aside className={s.utilityRail}>
          <button
            className={p.view === 'overview' ? s.railSelected : s.railButton}
            aria-label="Overview"
            onClick={() => p.navigate('overview')}
          >
            <Icon name="home" size={18} />
          </button>
          <button
            className={p.view === 'senders' ? s.railSelected : s.railButton}
            aria-label="Senders"
            onClick={review}
          >
            <Icon name="mail" size={18} />
          </button>
          <div className={s.railDivider} />
          <button
            className={s.railButton}
            aria-label="About protection"
            onClick={() =>
              info(
                'Protect what matters',
                'Protected senders are excluded from bulk and automatic cleanup. You can inspect and change protection in sender details.',
              )
            }
          >
            <Icon name="shield" size={18} />
          </button>
          <button
            className={s.railButton}
            aria-label="About this preview"
            onClick={() =>
              info(
                'A working design preview',
                'Explore sample senders, inspect messages, preview an action and switch between the two design directions. Changes exist only in this preview.',
              )
            }
          >
            <Icon name="more" size={18} />
          </button>
          <span className={s.railBottom}>DM</span>
        </aside>
        <main className={s.workspace}>
          {p.view === 'overview' ? (
            <>
              <div className={s.pageHeading}>
                <div>
                  <div className={s.breadcrumb}>WORKSPACE / OVERVIEW</div>
                  <h1>A clearer starting point.</h1>
                  <p>Your inbox, understood. Your next move, considered.</p>
                </div>
                <span className={s.status}>
                  <span /> Sample inbox
                </span>
              </div>
              <div className={s.overviewGrid}>
                <section className={s.opportunity}>
                  <div className={s.eyebrow}>YOUR NEXT MOVE</div>
                  <div className={s.opportunityTitle}>
                    <h2>
                      Start with the
                      <br />
                      biggest senders.
                    </h2>
                    <span className={s.targetGlyph}>
                      <Icon name="arrow" size={44} />
                    </span>
                  </div>
                  <p>
                    A few considered decisions can make a visible difference.
                    <br />
                    Inspect the evidence, then choose what stays.
                  </p>
                  <div className={s.opportunityBottom}>
                    {primary('Review senders')}
                    <span>
                      {p.senders.filter((sender) => !sender.protected).length} unprotected senders
                      in this sample
                    </span>
                  </div>
                </section>
                <section className={s.ledger}>
                  <div className={s.sectionHeading}>
                    <h2>Activity ledger</h2>
                    <span>PREVIEW</span>
                  </div>
                  {p.lastResult ? (
                    <div className={s.ledgerItem}>
                      <span className={s.ledgerIcon}>
                        <Icon name="check" size={17} />
                      </span>
                      <div>
                        <strong>{p.lastResult}</strong>
                        <small>Just now · Simulated action</small>
                      </div>
                    </div>
                  ) : (
                    <div className={s.ledgerItem}>
                      <span className={s.ledgerIcon}>
                        <Icon name="mail" size={17} />
                      </span>
                      <div>
                        <strong>Your workspace is ready</strong>
                        <small>Explore a sample, make a decision</small>
                      </div>
                    </div>
                  )}
                  <div className={s.ledgerItem}>
                    <span className={s.ledgerIcon}>
                      <Icon name="shield" size={17} />
                    </span>
                    <div>
                      <strong>
                        {p.senders.filter((sender) => sender.protected).length}{' '}
                        {p.senders.filter((sender) => sender.protected).length === 1
                          ? 'sender'
                          : 'senders'}{' '}
                        protected
                      </strong>
                      <small>Excluded from bulk cleanup</small>
                    </div>
                  </div>
                  <div className={s.ledgerNote}>
                    A clear record of what changed,
                    <br />
                    and what needs your attention.
                  </div>
                </section>
              </div>
              <div className={s.metrics}>
                {[
                  [String(total), 'In the sample inbox'],
                  [String(p.senders.length), 'Senders to explore'],
                  [String(p.cleared), 'Emails cleared · all time'],
                  [
                    String(p.senders.filter((sender) => sender.protected).length),
                    'Protected senders',
                  ],
                ].map(([number, label], i) => (
                  <div key={label}>
                    <span className={s.metricIndex}>0{i + 1}</span>
                    <strong>{number}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <section className={s.senderSection}>
                <div className={s.sectionHeading}>
                  <div>
                    <span className={s.eyebrow}>THE BIGGER PICTURE</span>
                    <h2>Meet your inbox.</h2>
                  </div>
                  <button className={s.textButton} onClick={review}>
                    All senders <Icon name="arrow" size={14} />
                  </button>
                </div>
                {senderRows(true)}
                <p className={s.footnote}>
                  ¹ Marked read reflects Gmail labels, not confirmed opens.
                </p>
              </section>
            </>
          ) : (
            <>
              <div className={s.pageHeading}>
                <div>
                  <div className={s.breadcrumb}>WORKSPACE / SENDERS</div>
                  <h1>Know what you're keeping.</h1>
                  <p>Volume, context and a clear next step. All in one place.</p>
                </div>
              </div>
              <div className={s.senderWorkspace}>
                <section className={s.senderList}>
                  <div className={s.listToolbar}>
                    <span>
                      <strong>{filteredSenders.length}</strong> sample senders
                    </span>
                  </div>
                  <label className={s.searchField}>
                    <Icon name="search" size={15} />
                    <input
                      type="search"
                      aria-label="Search sample senders"
                      placeholder="Search by name or email"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <SenderWorkspaceControls p={p} styles={s} />
                  {senderRows()}
                  <p className={s.footnote}>
                    ¹ Marked read reflects Gmail labels, not confirmed opens.
                  </p>
                  <div className={s.listNote}>
                    <Icon name="shield" size={17} />
                    <p>
                      <strong>Important mail deserves extra care.</strong>
                      <br />
                      Protected senders stay out of bulk cleanup and automation.
                    </p>
                  </div>
                </section>
                <aside className={s.inspector} ref={inspectorRef}>
                  <div className={s.inspectorEyebrow}>
                    SENDER INSPECTOR{' '}
                    <span>
                      {String(
                        p.senders.findIndex((sender) => sender.id === p.selected.id) + 1,
                      ).padStart(2, '0')}{' '}
                      / {String(p.senders.length).padStart(2, '0')}
                    </span>
                  </div>
                  <div className={s.inspectorIdentity}>
                    <SenderAvatar sender={p.selected} size={48} />
                    <h2>{p.selected.name}</h2>
                    <p>{p.selected.email}</p>
                  </div>
                  <button
                    className={p.selected.protected ? s.protectedButton : s.protectButton}
                    onClick={p.toggleProtection}
                  >
                    <Icon name="shield" size={14} />
                    {p.selected.protected ? 'Protected · Remove protection' : 'Protect this sender'}
                    <Icon name="plus" size={12} />
                  </button>
                  <div className={s.inspectorMetrics}>
                    <div>
                      <strong>{p.selected.inbox}</strong>
                      <span>in inbox</span>
                    </div>
                    <div>
                      <strong>{p.selected.markedRead}%</strong>
                      <span>marked read · 90d</span>
                    </div>
                    <div>
                      <strong>{p.selected.total}</strong>
                      <span>received in sample</span>
                    </div>
                  </div>
                  <div className={s.chartHeading}>
                    <span>12-WEEK VOLUME</span>
                    <span>Last received {p.selected.lastSeen.toLowerCase()}</span>
                  </div>
                  <Sparkline values={p.selected.trend} className={s.largeSparkline ?? ''} />
                  <div className={s.actionArea}>
                    <span className={s.eyebrow}>MAKE YOUR NEXT MOVE</span>
                    <button className={s.primary} onClick={() => p.previewAction('Archive')}>
                      Preview archive <Icon name="arrow" size={15} />
                    </button>
                    <div className={s.secondaryActions}>
                      <button onClick={() => p.previewAction('Keep')}>Keep</button>
                      <button onClick={() => p.previewAction('Unsubscribe')}>Unsubscribe</button>
                      <button onClick={() => p.previewAction('Later')}>Later</button>
                      <button onClick={() => p.previewAction('Delete')}>Delete</button>
                    </div>
                    <p>Inspect the scope before confirming a change.</p>
                  </div>
                  <section className={s.messageSection}>
                    <div className={s.sectionHeading}>
                      <h3>Recent messages</h3>
                      <span>METADATA ONLY</span>
                    </div>
                    {p.selected.messages.map((message) => (
                      <article key={message.subject}>
                        <div>
                          <Icon name="mail" size={13} />
                          <time>{message.date}</time>
                        </div>
                        <h4>
                          <button
                            className={s.messageLink}
                            onClick={() =>
                              p.showInfo(
                                message.subject,
                                `${message.snippet} This is a fictional message sample for the design prototype.`,
                              )
                            }
                          >
                            {message.subject}
                          </button>
                        </h4>
                        {p.fullDetails && <p>{message.snippet}</p>}
                      </article>
                    ))}
                    <button className={s.textButton} onClick={p.openFullDetails}>
                      {p.fullDetails ? 'Show less detail' : 'Expand sender details'}
                      <Icon name="plus" size={14} />
                    </button>
                    {p.fullDetails && (
                      <div className={s.fullDetails}>
                        <span>First seen: {p.selected.firstSeen}</span>
                        <span>
                          {p.selected.protected
                            ? 'Protected by you · excluded from bulk cleanup and automation'
                            : `${p.selected.inbox} emails in your inbox · ${p.selected.markedRead}% marked read in the last 90 days`}
                        </span>
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
