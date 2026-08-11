/**
 * D38 first-run tour — the three behaviours the decision turns on:
 * it teaches the five verbs once, it never re-fires, and Settings can
 * bring it back.
 *
 * These drive the REAL hooks through the fetch stub rather than mocking
 * them. The flag is the whole feature, so a test that stubbed the flag
 * would assert nothing about whether it round-trips.
 */

import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { OnboardingVerbTour, VerbTourDialog } from './verb-tour';
import { VERB_LESSONS } from './verb-lessons';

/** Stand-in for the user row the API reads the flag off. */
let serverState: { verbTourCompletedAt: string | null };
let postCount: number;

function installOnboardingStateStub() {
  installFetchStub([
    {
      method: 'GET',
      path: '/api/onboarding/state',
      respond: () =>
        jsonOk({
          data: {
            onboardedAt: null,
            skipped: false,
            goal: 'reduce_newsletters',
            presetPicks: [],
            presets: [],
            verbTourCompletedAt: serverState.verbTourCompletedAt,
          },
        }),
    },
    {
      method: 'POST',
      path: '/api/onboarding/verb-tour',
      respond: () => {
        postCount += 1;
        serverState.verbTourCompletedAt = '2026-08-10T10:00:00.000Z';
        return jsonOk({
          data: {
            onboardedAt: null,
            skipped: false,
            goal: 'reduce_newsletters',
            presetPicks: [],
            presets: [],
            verbTourCompletedAt: serverState.verbTourCompletedAt,
          },
        });
      },
    },
  ]);
}

/** A fresh QueryClient per mount — this is what a page reload is. */
function mount(el: ReactElement) {
  return render(<QueryWrapper client={createTestQueryClient()}>{el}</QueryWrapper>);
}

beforeEach(() => {
  serverState = { verbTourCompletedAt: null };
  postCount = 0;
  installOnboardingStateStub();
});

describe('OnboardingVerbTour', () => {
  it('teaches every verb with its shortcut and its effect on the mail', async () => {
    mount(<OnboardingVerbTour />);

    await screen.findByText('Five decisions, one sender at a time');

    // All five, each naming the verb, the key, and what it does — the
    // three things D38 asks the education to carry.
    expect(VERB_LESSONS).toHaveLength(5);
    for (const lesson of VERB_LESSONS) {
      expect(screen.getByText(lesson.label)).toBeInTheDocument();
      expect(screen.getByText(lesson.shortcut)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(escapeRegExp(lesson.effect)))).toBeInTheDocument();
    }
  });

  it('never uses the internal word for the Screener verdict (D227)', async () => {
    const { container } = mount(<OnboardingVerbTour />);
    await screen.findByText('Five decisions, one sender at a time');

    expect(container.textContent).not.toMatch(/\bScreen\b/);
  });

  it('walks the preview and recommendation steps D38 asks it to point out', async () => {
    mount(<OnboardingVerbTour />);
    await screen.findByText('Five decisions, one sender at a time');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('You see what changes before it changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('A highlighted verb is a suggestion')).toBeInTheDocument();

    // Back returns rather than restarting.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('You see what changes before it changes')).toBeInTheDocument();
  });

  it('persists the dismissal and hides the tour immediately', async () => {
    mount(<OnboardingVerbTour />);
    await screen.findByText('Five decisions, one sender at a time');

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    await waitFor(() =>
      expect(screen.queryByText('Five decisions, one sender at a time')).not.toBeInTheDocument(),
    );
    expect(postCount).toBe(1);
    expect(serverState.verbTourCompletedAt).not.toBeNull();
  });

  it('does not re-fire on a reload once it has been dismissed', async () => {
    const first = mount(<OnboardingVerbTour />);
    await screen.findByText('Five decisions, one sender at a time');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(serverState.verbTourCompletedAt).not.toBeNull());
    first.unmount();

    // Fresh client + fresh mount = the returning user's next visit.
    mount(<OnboardingVerbTour />);

    await waitFor(() => expect(postCount).toBe(1));
    expect(screen.queryByText('Five decisions, one sender at a time')).not.toBeInTheDocument();
  });

  it('stays hidden for a user who completed the tour before this mount', async () => {
    serverState.verbTourCompletedAt = '2026-08-01T00:00:00.000Z';

    mount(<OnboardingVerbTour />);

    await waitFor(() => expect(postCount).toBe(0));
    expect(screen.queryByText('Five decisions, one sender at a time')).not.toBeInTheDocument();
  });
});

describe('VerbTourDialog (the Settings replay)', () => {
  it('brings the tour back after it was dismissed', async () => {
    serverState.verbTourCompletedAt = '2026-08-01T00:00:00.000Z';

    mount(<VerbTourDialog onClose={() => {}} />);

    // The replay does not consult the flag — that is the point of a
    // replay control.
    expect(await screen.findByText('Five decisions, one sender at a time')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('labels its dialog from the panel heading', async () => {
    mount(<VerbTourDialog onClose={() => {}} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'dm-verb-tour-replay-title');
    expect(document.getElementById('dm-verb-tour-replay-title')).toHaveTextContent(
      'Five decisions, one sender at a time',
    );
  });

  it('closes only after the write lands, so a failed save is not silent', async () => {
    let closed = false;
    mount(<VerbTourDialog onClose={() => (closed = true)} />);
    await screen.findByText('Five decisions, one sender at a time');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    await waitFor(() => expect(closed).toBe(true));
    expect(postCount).toBe(1);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
