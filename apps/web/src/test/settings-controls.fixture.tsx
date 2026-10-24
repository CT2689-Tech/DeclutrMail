import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CookiePreferences } from '../features/consent/cookie-preferences';
import { SettingsGroup, SettingsRow, SettingsSwitch } from '../features/settings/settings-list';
import { Switch } from '../features/settings/switch';

const params = new URLSearchParams(window.location.search);
if (params.has('theme')) document.documentElement.dataset.theme = params.get('theme')!;

function SettingsControls() {
  const [on, setOn] = useState(false);
  return (
    <main style={{ maxWidth: 560, padding: 16, margin: '0 auto', display: 'grid', gap: 24 }}>
      {params.get('surface') !== 'public' && <span id="dm-app-theme" hidden />}
      <h1>Settings controls</h1>
      <SettingsGroup title="Email notifications">
        <SettingsRow label="Reminder emails">
          <SettingsSwitch
            ariaLabel="Reminder emails"
            on={on}
            stateLabel={on ? 'On' : 'Off'}
            disabled={false}
            pending={false}
            onToggle={() => setOn(!on)}
          />
        </SettingsRow>
        <SettingsRow label="Unavailable preference">
          <Switch checked={false} disabled ariaLabel="Unavailable preference" onChange={setOn} />
        </SettingsRow>
      </SettingsGroup>
      <CookiePreferences />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<SettingsControls />);
