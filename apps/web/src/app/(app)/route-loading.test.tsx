import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { editorialColumnStyle, editorialTitleStyle } from '@/features/editorial/page';
import Activity from './activity/loading';
import Autopilot from './autopilot/loading';
import Brief from './brief/loading';
import Followups from './followups/loading';
import Later from './later/loading';
import Quiet from './quiet/loading';
import Screener from './screener/loading';
import Settings from './settings/loading';
import Triage from './triage/loading';

const routes = [
  { View: Activity, title: 'Activity', kicker: 'Your history / Every outcome in view', gap: 20 },
  { View: Autopilot, title: 'Autopilot', kicker: 'Automations / Your rules', gap: 32 },
  { View: Brief, title: 'Daily Brief', kicker: 'Catch up / Your daily edition', gap: 24 },
  { View: Followups, title: 'Follow-ups', kicker: 'Catch up / Conversations', gap: 32 },
  { View: Later, title: 'Later', kicker: 'Catch up / Coming back to you', gap: 32 },
  { View: Quiet, title: 'Quiet hours', kicker: 'Automations / On your schedule', gap: 24 },
  { View: Screener, title: 'Screener', kicker: 'Clean up / New senders', gap: 24 },
  { View: Settings, title: 'Settings', kicker: 'Your workspace / Preferences', gap: 32 },
];

describe('Route loading continuity', () => {
  it.each(routes)(
    '$title retains the ready screen identity and editorial geometry',
    ({ View, title, kicker, gap }) => {
      render(<View />);
      const heading = screen.getByRole('heading', { level: 1, name: title });
      // Assert the streamed CSS text: jsdom does not compute font vars/clamp.
      const html = renderToStaticMarkup(<View />);
      expect(html).toContain(`font-family:${editorialTitleStyle.fontFamily}`);
      expect(html).toContain(`font-size:${editorialTitleStyle.fontSize}`);
      expect(html).toContain(`padding:${editorialColumnStyle.padding}`);
      expect(heading.parentElement).toHaveStyle({ maxWidth: '1120px', gap: `${gap}px` });
      expect(screen.getByText(kicker)).toBeInTheDocument();
      expect(screen.getByRole('status', { name: /Loading/i })).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
  it('adopts persisted List geometry after hydration while SSR stays deterministic', () => {
    localStorage.setItem('dm.triage.mode', JSON.stringify('list'));
    try {
      expect(renderToStaticMarkup(<Triage />)).toContain('max-width:688px');
      render(<Triage />);
      const wrapper = screen.getByRole('heading', { name: 'Triage', level: 1 }).parentElement;
      expect(wrapper).toHaveStyle({ maxWidth: '928px' });
      expect(wrapper).toHaveAttribute('data-triage-mode', 'list');
      expect(localStorage.getItem('dm.triage.mode')).toBe('"list"');
    } finally {
      localStorage.removeItem('dm.triage.mode');
    }
  });
  it('preserves the narrower Triage decision layout with the same editorial title', () => {
    render(<Triage />);
    const heading = screen.getByRole('heading', { name: 'Triage', level: 1 });
    expect(renderToStaticMarkup(<Triage />)).toContain(
      `font-family:${editorialTitleStyle.fontFamily}`,
    );
    expect(heading.parentElement).toHaveStyle({ maxWidth: '688px', gap: '20px' });
    expect(heading.parentElement?.className).toContain('triage');
    expect(screen.getByText('Clean up / A considered decision')).toBeInTheDocument();
  });
});
