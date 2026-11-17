// Route boundary for `/connect/*` (MCP connector consent, ADR-0048).
//
// Authed but outside the app shell, like `/onboarding`: `/connect` is in
// `AUTHED_APP_PATHS`, so middleware gives it the strict nonce CSP, and
// the theme resolver must carry that nonce to run.

import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { ToastHost } from '@declutrmail/shared';

import workspaceAppearance from '@/features/theme/workspace-appearance.module.css';
import { ThemeScript } from '@/features/theme/theme-script';
import '@/features/theme/app-light-theme.css';

export default async function ConnectLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <ThemeScript nonce={nonce} />
      <span id="dm-app-theme" hidden />
      <div className={workspaceAppearance.content} data-workspace-appearance="">
        {children}
      </div>
      <ToastHost />
    </>
  );
}
