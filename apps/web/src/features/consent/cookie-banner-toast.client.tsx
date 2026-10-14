import { createRoot } from 'react-dom/client';
import {
  ToastHost,
  UndoTray,
  bottomClearOfCookieBanner,
  toast,
  type UndoTrayEntry,
} from '@declutrmail/shared';

import { floatingSurfaceLayout } from '../../lib/ui/floating-surface-layout';
import { CookieConsentBannerView } from './cookie-consent-banner-view';

/**
 * Browser entry for the 360px render check. The Playwright spec bundles
 * this file and does not assign the cookie-banner or undo-tray CSS
 * variables; those come from the mounted components.
 */
const entry: UndoTrayEntry = {
  token: '11111111-1111-4111-8111-111111111111',
  actionKind: 'archive',
  affectedCount: 12,
  createdAt: '2026-06-09T14:35:00Z',
  expiresAt: '2026-06-16T14:35:00Z',
};

toast('Archived 12 emails', 'success', { label: 'Undo', onClick: () => undefined });

const root = document.getElementById('root');
if (root === null) throw new Error('cookie banner toast fixture root missing');

createRoot(root).render(
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
    <ToastHost />
    <CookieConsentBannerView onChoose={() => undefined} />
  </>,
);
