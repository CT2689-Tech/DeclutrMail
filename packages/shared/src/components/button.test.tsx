// Contract test for the shared Button's toggle semantics (D42/D43).
//
// Protected chips on the sender detail page pass `aria-pressed`
// straight through JSX, but Button only forwards destructured props —
// the attribute silently never reached the DOM (caught live
// 2026-06-11: screen readers saw no toggle state and the Playwright
// component spec had to match on label text). `ariaPressed` is now a real
// prop; this test pins the forwarding so it cannot regress.
//
// Rendered via react-dom/server, matching the shared package's
// DOM-free test convention (see privacy-badge.test.tsx).

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './button';
import { color } from '../tokens/tokens';

describe('Button — ariaPressed forwarding (D43)', () => {
  it('renders aria-pressed="true" when ariaPressed is true', () => {
    const html = renderToStaticMarkup(<Button ariaPressed={true}>Protected</Button>);
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders aria-pressed="false" when ariaPressed is false', () => {
    const html = renderToStaticMarkup(<Button ariaPressed={false}>Protected</Button>);
    expect(html).toContain('aria-pressed="false"');
  });

  it('omits aria-pressed entirely when ariaPressed is undefined (non-toggle buttons stay plain buttons)', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).not.toContain('aria-pressed');
  });

  it('still forwards aria-label alongside aria-pressed', () => {
    const html = renderToStaticMarkup(
      <Button ariaPressed={true} ariaLabel="Toggle protection">
        Protected
      </Button>,
    );
    expect(html).toContain('aria-label="Toggle protection"');
    expect(html).toContain('aria-pressed="true"');
  });
});

// Pins the tone fills the verb surfaces depend on (ADR-0016 A5 +
// ADR-0019): Keep's lead CTA fills teal from `color.primary`, and the
// Delete surfaces (popover entry, confirm-modal CTA) fill from the
// canonical `color.danger` family — NOT the legacy `color.red`, which
// is on its way out per the tokens.ts migration note.
describe('Button — tone fills (ADR-0016 A5 + ADR-0019)', () => {
  it('danger tone fills from color.danger, hover from color.dangerDeep', () => {
    const html = renderToStaticMarkup(<Button tone="danger">Delete</Button>);
    expect(html).toContain(`background:${color.danger}`);
    expect(html).not.toContain(color.red);
  });

  it('primary tone fills from color.primary (Keep lead CTA teal)', () => {
    const html = renderToStaticMarkup(<Button tone="primary">Keep</Button>);
    expect(html).toContain(`background:${color.primary}`);
  });
});
