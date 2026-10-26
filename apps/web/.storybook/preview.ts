// Storybook global decorators + parameters (D210).
//
// The design tokens are CSS custom properties (`--dm-*`) defined in
// `packages/shared/src/styles/tokens.css`. Every component reads them
// through `tokens.color.*`, so without this import each story renders
// with unresolved variables — visually broken in a way that looks like
// a component bug rather than a missing stylesheet.
import '@declutrmail/shared/tokens.css';
import '../src/features/theme/app-light-theme.css';
import workspaceAppearance from '../src/features/theme/workspace-appearance.module.css';

import type { Preview } from '@storybook/nextjs-vite';
import { createElement, useEffect, type ReactNode } from 'react';

// Theme the document so overlays/portals use the same tokens as each story.
function ThemePreview({
  theme,
  workspace,
  appTheme,
  children,
}: {
  theme: string;
  workspace: boolean;
  appTheme: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return createElement(
    'div',
    {
      style: {
        minHeight: '100vh',
        background: 'var(--dm-bg)',
        color: 'var(--dm-fg)',
        fontFamily: 'var(--dm-font-sans)',
      },
    },
    appTheme ? createElement('span', { id: 'dm-app-theme', hidden: true }) : null,
    createElement(
      'div',
      {
        className: workspaceAppearance.content,
        'data-workspace-appearance': workspace ? '' : undefined,
      },
      children,
    ),
  );
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Product color theme',
      toolbar: { icon: 'paintbrush', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, context) =>
      createElement(ThemePreview, {
        theme: context.globals.theme === 'dark' ? 'dark' : 'light',
        workspace: /^(Senders|Autopilot|Features\/(Activity|Brief|Followups|Later|Senders))\//.test(
          context.title,
        ),
        appTheme:
          /^(Home|Senders|Autopilot|Features\/(Activity|Brief|Followups|Later|Senders))\//.test(
            context.title,
          ),
        children: createElement(Story),
      }),
  ],
  parameters: {
    // Stories set their own `layout` (centered / fullscreen); this is
    // just the fallback for the ones that do not.
    layout: 'padded',
    controls: { expanded: true },
  },
};

export default preview;
