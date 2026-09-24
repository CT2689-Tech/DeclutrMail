import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
  prototype: vi.fn(() => <div>Sample design study</div>),
}));

vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('@/features/design-prototype/design-prototype', () => ({
  DesignPrototype: h.prototype,
}));

import DesignPrototypePage, { metadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('development design study route', () => {
  it('returns the Next.js not-found boundary before rendering the study in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => DesignPrototypePage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(h.notFound).toHaveBeenCalledOnce();
    expect(h.prototype).not.toHaveBeenCalled();
  });

  it('renders the study in development and keeps it out of search indexing', () => {
    vi.stubEnv('NODE_ENV', 'development');

    render(<DesignPrototypePage />);

    expect(screen.getByText('Sample design study')).toBeInTheDocument();
    expect(h.notFound).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
