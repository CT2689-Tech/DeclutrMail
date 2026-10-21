import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ActivityFilterDialog } from '../activity/activity-filter-dialog';
import type { FilterFieldsProps } from '../activity/activity-filter-fields';
import { AccountMenu } from '../mailboxes/account-menu';
import { CookieConsentBannerView } from './cookie-consent-banner-view';

/** Actual overlay components; the render spec substitutes only account data/network boundaries. */
function OverlayFixture() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<FilterFieldsProps['source']>('all');
  const [applied, setApplied] = useState(false);
  const [consent, setConsent] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const account = new URLSearchParams(window.location.search).get('surface') === 'account';
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'flex-end', padding: 16 }}>
        {account && <AccountMenu />}
      </header>
      {!account && (
        <main style={{ padding: 16 }}>
          <h1>Activity</h1>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ position: 'relative' }}>
              <button ref={trigger} type="button" onClick={() => setOpen(true)}>
                Filter
              </button>
              {open && (
                <ActivityFilterDialog
                  isMobile={window.matchMedia('(max-width: 760px)').matches}
                  source={source}
                  verbs={[]}
                  window="30d"
                  dateFrom={null}
                  dateTo={null}
                  onSource={setSource}
                  onVerbs={() => undefined}
                  onWindow={() => undefined}
                  onRange={() => undefined}
                  returnFocusRef={trigger}
                  onClose={() => {
                    setOpen(false);
                    setApplied(true);
                  }}
                />
              )}
            </div>
          </div>
          {applied && <output role="status">Applied source: {source}</output>}
        </main>
      )}
      {!consent && <CookieConsentBannerView onChoose={() => setConsent(true)} />}
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('cookie banner overlay fixture root missing');
createRoot(root).render(<OverlayFixture />);
