import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewSheet } from '@declutrmail/shared';

import { CookieConsentBannerView } from './cookie-consent-banner-view';

// This isolated SSR subprocess renders web JSX (normally compiled by Next).
// tsx preserves that package's classic JSX runtime, unlike shared's automatic one.
Object.assign(globalThis, { React });

process.stdout.write(
  renderToStaticMarkup(
    <>
      <PreviewSheet
        onClose={() => undefined}
        title="Delete 45 emails?"
        subtitle="These emails move to Gmail Trash."
        note="Undo from Activity for 7 days."
        primary={{ label: 'Delete 45', onClick: () => undefined, tone: 'danger' }}
      />
      <CookieConsentBannerView onChoose={() => undefined} />
    </>,
  ),
);
