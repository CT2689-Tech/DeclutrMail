// Contract test for the shared Button's toggle semantics (D42/D43).
//
// VIP/Protect chips on the sender detail page passed `aria-pressed`
// straight through JSX, but Button only forwards destructured props —
// the attribute silently never reached the DOM (caught live
// 2026-06-11: screen readers saw no toggle state and the Playwright
// VIP spec had to match on label text). `ariaPressed` is now a real
// prop; this test pins the forwarding so it cannot regress.
//
// Rendered via react-dom/server, matching the shared package's
// DOM-free test convention (see privacy-badge.test.tsx).

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './button';

describe('Button — ariaPressed forwarding (D43)', () => {
  it('renders aria-pressed="true" when ariaPressed is true', () => {
    const html = renderToStaticMarkup(<Button ariaPressed={true}>VIP</Button>);
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders aria-pressed="false" when ariaPressed is false', () => {
    const html = renderToStaticMarkup(<Button ariaPressed={false}>VIP</Button>);
    expect(html).toContain('aria-pressed="false"');
  });

  it('omits aria-pressed entirely when ariaPressed is undefined (non-toggle buttons stay plain buttons)', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).not.toContain('aria-pressed');
  });

  it('still forwards aria-label alongside aria-pressed', () => {
    const html = renderToStaticMarkup(
      <Button ariaPressed={true} ariaLabel="Toggle VIP">
        ★ VIP
      </Button>,
    );
    expect(html).toContain('aria-label="Toggle VIP"');
    expect(html).toContain('aria-pressed="true"');
  });
});
