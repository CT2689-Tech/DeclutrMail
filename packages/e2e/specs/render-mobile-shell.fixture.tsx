import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '@declutrmail/shared';

// Isolated SSR subprocess. tsx compiles this file with shared's JSX runtime.
Object.assign(globalThis, { React });

process.stdout.write(
  renderToStaticMarkup(
    <div className="dm-app-viewport" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <AppShell active="home" onNavigate={() => undefined}>
          <div>
            <a className="dm-external-link dm-tap-target" href="/pricing">
              Compare plans
            </a>
            <p style={{ fontSize: 13 }}>
              <a className="dm-tap-target" href="/settings/help">
                Billing help
              </a>
              {' · '}
              <a className="dm-tap-target" href="/refunds">
                Refund policy
              </a>
            </p>
            <div style={{ fontSize: 13 }}>
              <a className="dm-tap-target" href="/settings">
                Manage inboxes
              </a>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <a
                className="dm-tap-target"
                href="/senders/1"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                Newsletter
              </a>
            </div>
            <div role="group" aria-label="Saved filters" style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="dm-tap-44">
                Mostly unread (90 days)
              </button>
              <button type="button" className="dm-tap-44">
                Has unsubscribe link
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="dm-tap-44 dm-fixed-40">
                Mail in Inbox
              </button>
              <button type="button" className="dm-tap-44 dm-fixed-40">
                Filter
              </button>
              <button type="button" className="dm-tap-44 dm-fixed-40">
                Sort: Most received
              </button>
            </div>
            <p style={{ fontSize: 13, margin: 0 }}>
              <a className="dm-tap-target" href="/billing">
                See plans
              </a>
            </p>
            <section className="dm-report" aria-label="Your Inbox Report">
              <header>
                <span>Report</span>
                <button type="button" className="dm-tap-44" aria-label="Close Inbox Report">
                  ×
                </button>
              </header>
              <p style={{ fontSize: 13, margin: 0 }}>
                <a className="dm-tap-target" href="/settings/privacy">
                  What we store and share
                </a>
              </p>
            </section>
            <a className="dm-external-link dm-tap-target" href="/privacy#ai-processing">
              How we use AI
            </a>
            <button
              type="button"
              className="dm-tap-44"
              aria-label="More actions for Newsletter"
              style={{ width: 32, height: 32, padding: 0 }}
            >
              ⋯
            </button>
            <div style={{ height: 900 }} />
            <button type="button" data-report-fix style={{ height: 45, width: '100%' }}>
              Unsubscribe + archive
            </button>
            <div id="sticky-actions" style={{ position: 'sticky', bottom: 14, height: 52 }}>
              <button type="button">Archive selected</button>
            </div>
            <div style={{ height: 1400 }} />
            <div id="shell-end" style={{ height: 48, background: '#c45c26' }}>
              End of page
            </div>
          </div>
        </AppShell>
      </div>
    </div>,
  ),
);
