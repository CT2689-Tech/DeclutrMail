import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LaunchFilterRow } from './launch-filter-row';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

describe('LaunchFilterRow phone targets', () => {
  it('marks each saved filter for a 44px phone hit area', () => {
    render(<LaunchFilterRow mailboxId={null} onApply={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Mostly unread (90 days)' })).toHaveClass(
      'dm-tap-44',
    );
    expect(screen.getByRole('button', { name: 'Has unsubscribe link' })).toHaveClass('dm-tap-44');
  });

  it('marks Mail in Inbox for the same phone hit area', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'senders-screen.tsx'),
      'utf8',
    );
    expect(source).toContain('className={`${workspaceStyles.inboxFilter} dm-tap-44`}');
  });

  it('widens the narrow phone row so the 44px menu fits', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'sender-workspace.module.css'),
      'utf8',
    );
    const phone = css.slice(css.lastIndexOf('@media (max-width: 760px)'));
    expect(phone).toContain('grid-template-columns: 44px minmax(0, 1fr) 44px !important');
  });
});
