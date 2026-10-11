import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
  preview: vi.fn(() => <div>Home fixture</div>),
}));

vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('@/features/home/home-preview', () => ({
  HomePreview: h.preview,
  parseHomePreviewState: (value: string | undefined) => value ?? 'full',
}));
vi.mock('@/features/theme/theme-script', () => ({ ThemeScript: () => null }));

import HomePreviewPage, { metadata } from './page';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('home preview route', () => {
  it('returns not-found on a production deploy before rendering fixtures', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NODE_ENV', 'production');

    await expect(HomePreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(h.notFound).toHaveBeenCalledOnce();
    expect(h.preview).not.toHaveBeenCalled();
  });

  it('renders the fixture shell on a preview deploy and stays out of search', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NODE_ENV', 'production');

    render(await HomePreviewPage({ searchParams: Promise.resolve({ state: 'queued' }) }));

    expect(screen.getByText('Home fixture')).toBeInTheDocument();
    expect(h.preview).toHaveBeenCalledWith({ state: 'queued' }, undefined);
    expect(h.notFound).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
