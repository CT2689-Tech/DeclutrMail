// Contract tests for <WeeklyProgress /> (Variant D).

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeeklyProgress } from './weekly-progress';

describe('<WeeklyProgress /> — Variant D', () => {
  it('renders label, done/total, and progress bar with correct percent', () => {
    const html = renderToStaticMarkup(<WeeklyProgress label="This week" done={2} total={5} />);
    expect(html).toContain('This week');
    expect(html).toContain('2 of 5');
    expect(html).toContain('cleanup decisions done');
    // 2/5 = 40% — width style on the fill div
    expect(html).toContain('width:40%');
  });

  it('renders the optional caption when provided', () => {
    const html = renderToStaticMarkup(
      <WeeklyProgress
        label="This week"
        done={2}
        total={5}
        caption="Estimated savings so far: 3.1h/year"
      />,
    );
    expect(html).toContain('Estimated savings so far: 3.1h/year');
  });

  it('omits the caption separator when no caption is supplied', () => {
    const html = renderToStaticMarkup(<WeeklyProgress label="This week" done={2} total={5} />);
    // The " · " separator only appears with a caption; assert the test
    // copy that would follow it is not present.
    expect(html).not.toContain('Estimated savings');
  });

  it('returns null when total is zero (no decisions to track)', () => {
    const html = renderToStaticMarkup(<WeeklyProgress label="This week" done={0} total={0} />);
    expect(html).toBe('');
  });

  it('caps percentage at 100 even when done exceeds total', () => {
    const html = renderToStaticMarkup(<WeeklyProgress label="This week" done={8} total={5} />);
    expect(html).toContain('width:100%');
  });

  it('renders 0% width when nothing is done yet', () => {
    const html = renderToStaticMarkup(<WeeklyProgress label="This week" done={0} total={5} />);
    expect(html).toContain('width:0%');
    expect(html).toContain('0 of 5');
  });

  it('exposes aria attributes for the progress bar', () => {
    const html = renderToStaticMarkup(<WeeklyProgress label="This week" done={2} total={5} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain('aria-valuemin="0"');
  });
});
