import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UndoTray,
  bottomClearOfCookieBanner,
  toastStackPosition,
  type UndoTrayEntry,
} from '@declutrmail/shared';

import { floatingSurfaceLayout } from '../../lib/ui/floating-surface-layout';
import { ToastAnnouncement } from '../../../../../packages/shared/src/components/toast';
import { CookieConsentBannerView } from './cookie-consent-banner-view';

// This isolated SSR subprocess renders web JSX (normally compiled by Next).
// tsx preserves that package's classic JSX runtime, unlike shared's automatic one.
Object.assign(globalThis, { React });

const entry: UndoTrayEntry = {
  token: '11111111-1111-4111-8111-111111111111',
  actionKind: 'archive',
  affectedCount: 12,
  createdAt: '2026-06-09T14:35:00Z',
  expiresAt: '2026-06-16T14:35:00Z',
};

process.stdout.write(
  renderToStaticMarkup(
    <>
      <UndoTray
        dataSource={{
          entries: [entry],
          isLoading: false,
          revert: async () => undefined,
        }}
        style={{
          bottom: bottomClearOfCookieBanner(
            `${floatingSurfaceLayout.undoTrayBottom}px + var(--dm-tabbar-inset, 0px)`,
          ),
          zIndex: floatingSurfaceLayout.undoTrayZIndex,
        }}
      />
      <div data-testid="undo-toast" style={toastStackPosition()}>
        <ToastAnnouncement
          msg="Archived 12 emails"
          tone="success"
          action={{ label: 'Undo', onClick: () => undefined }}
        />
      </div>
      <CookieConsentBannerView onChoose={() => undefined} />
    </>,
  ),
);
