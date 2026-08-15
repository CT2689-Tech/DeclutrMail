// Print the SSR markup of the real `Avatar` to stdout.
//
// Run as a CHILD PROCESS by `specs/render-avatar-logo.spec.ts`, which
// cannot render it in-process: Playwright's transform compiles JSX with
// its own component-testing factory, so `avatar.tsx` comes back as
// `__pw_type` objects that React refuses to render. A child under `tsx`
// compiles it as ordinary React and hands back the exact markup the web
// app emits.
//
// `Avatar` reads its flag and API base at module scope, so the caller
// sets those in the child's env — see the spec.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Avatar } from '@declutrmail/shared';

const [name = 'Chase', domain = 'chase.com', size = '40'] = process.argv.slice(2);

process.stdout.write(
  renderToStaticMarkup(createElement(Avatar, { name, domain, size: Number(size) })),
);
