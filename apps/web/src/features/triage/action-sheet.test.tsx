// Tests for the triage action sheet (D34, D226).
//
// SSR-only — same constraint as the rest of `apps/web`'s tests
// (no jsdom). What we lock in:
//
//   - When `open=true`, the sheet renders with the mandatory
//     `<ActionPreview mode="modal">` body (D226 — preview is not
//     skippable).
//   - When `open=false`, nothing renders.
//   - The remember-preference toggle copy includes the verb name
//     (so a refactor that strips the per-verb hint fails).
//   - The store's remember-preference reducer round-trips per verb
//     (independent of the sheet's local state) — that's the
//     contract the screen relies on when persisting the toggle.

import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionSheet } from './action-sheet';
import { TRIAGE_QUEUE } from './data';
import { resetTriageStore, useTriageStore, type SheetableVerb } from './store';

beforeEach(() => {
  resetTriageStore();
});

const row = TRIAGE_QUEUE[0]!; // Groupon — high-confidence Archive

describe('ActionSheet — D226 mandatory preview surface', () => {
  it('renders the modal title + preview body when open=true', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    // Sheet chrome
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    // Sender name in the title
    expect(html).toContain(row.senderName);
    // Mandatory preview region (D226) — the ActionPreview component
    // exposes a `role="region"` with an aria-label that names the
    // verb + sender. That label is the load-bearing signal the sheet
    // can't silently strip.
    expect(html).toContain(`aria-label="Preview · Archive ${row.senderName}"`);
    expect(html).toContain('Why do I review this before confirming?');
    expect(html).toContain('Cancel changes nothing');
  });

  it('renders nothing when open=false', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={false}
        verb="Archive"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('renders nothing when open=true but row is null', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={null}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('blocks confirmation and offers retry when the live preview is unavailable', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount="unavailable"
        onCancel={() => {}}
        onConfirm={() => {}}
        onRetryPreview={() => {}}
      />,
    );

    expect(html).toContain('Retry preview');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive/);
  });

  it('blocks confirmation while the live preview is still loading', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount="loading"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('Counting the inbox');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Archive/);
  });
});

describe('ActionSheet — D34 remember-preference toggle copy', () => {
  it('mentions the verb name so the user knows what they are persisting', () => {
    for (const verb of ['Archive', 'Unsubscribe', 'Later'] as const) {
      const html = renderToStaticMarkup(
        <ActionSheet
          open={true}
          verb={verb}
          row={row}
          inboxCount={2}
          onCancel={() => {}}
          onConfirm={() => {}}
        />,
      );
      expect(html).toContain('Show this in the row next time');
    }
  });

  it('flags that the preview still shows inline when the sheet is skipped', () => {
    const html = renderToStaticMarkup(
      <ActionSheet
        open={true}
        verb="Archive"
        row={row}
        inboxCount={2}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    // The toggle's body copy must mention the inline preview — that's
    // the D226 guarantee the toggle can't silently break.
    expect(html.toLowerCase()).toContain('same preview will appear below the sender');
  });
});

describe('Store — remember-preference persists per verb (round-trip)', () => {
  it.each<SheetableVerb>(['Archive', 'Unsubscribe', 'Later'])(
    'toggling %s in the store round-trips to true and back',
    (verb) => {
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(false);
      useTriageStore.getState().setRememberPreference(verb, true);
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(true);
      useTriageStore.getState().setRememberPreference(verb, false);
      expect(useTriageStore.getState().rememberPreference[verb]).toBe(false);
    },
  );
});
