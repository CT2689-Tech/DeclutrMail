// Storybook global decorators + parameters (D210).
//
// The design tokens are CSS custom properties (`--dm-*`) defined in
// `packages/shared/src/styles/tokens.css`. Every component reads them
// through `tokens.color.*`, so without this import each story renders
// with unresolved variables — visually broken in a way that looks like
// a component bug rather than a missing stylesheet.
import '@declutrmail/shared/tokens.css';

import type { Preview } from '@storybook/nextjs-vite';

const preview: Preview = {
  parameters: {
    // Stories set their own `layout` (centered / fullscreen); this is
    // just the fallback for the ones that do not.
    layout: 'padded',
    controls: { expanded: true },
  },
};

export default preview;
