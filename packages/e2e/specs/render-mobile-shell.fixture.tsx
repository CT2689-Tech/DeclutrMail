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
