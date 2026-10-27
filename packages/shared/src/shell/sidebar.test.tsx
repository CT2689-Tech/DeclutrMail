import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATCH_UP_LATER_FIRST } from '../copy/screen-decisions';
import { NAV, Sidebar, SectionNavigation, WORKSPACE_NAV, workspaceSection } from './sidebar';

const routes = ['home', 'senders', 'autopilot', 'brief', 'followups', 'snoozed', 'activity'];
const labels = ['Home', 'Senders', 'Autopilot', 'Daily Brief', 'Follow-ups', 'Later', 'Activity'];
const groups = ['Home', 'Cleanup', 'Automations', 'Catch up', 'Activity'];
const render = (props: Partial<Parameters<typeof Sidebar>[0]> = {}) =>
  renderToStaticMarkup(<Sidebar active="senders" onNavigate={() => {}} collapsed {...props} />);

describe('Sidebar — approved workspace rail', () => {
  it('renders five named groups in order at 72px, plus brand and account destinations', () => {
    const html = render();
    expect(html).toContain('width:72px');
    let position = -1;
    for (const name of groups) {
      const next = html.indexOf(`aria-label="${name}"`);
      expect(next).toBeGreaterThan(position);
      position = next;
    }
    expect(html).toContain('aria-label="DeclutrMail Home"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).not.toContain('Expand sidebar');
    expect(html).not.toContain('Collapse sidebar');
  });

  it('keeps five labelled groups and separate account links in responsive mode', () => {
    const html = render({
      collapsed: false,
      responsive: true,
      active: 'settings/privacy',
      hrefFor: (id) => `/${id}`,
    });
    expect(html).toContain('dm-responsive-sidebar');
    for (const name of groups) expect(html).toContain(`>${name}</span>`);
    expect(html.match(/<aside/g)).toHaveLength(1);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Account navigation"');
    expect(html).toContain(
      'aria-label="Settings" aria-current="page" title="Settings" href="/settings"',
    );
    expect(html).toContain('href="/billing"');
    expect(html.indexOf('href="/settings"')).toBeLessThan(html.indexOf('href="/billing"'));
    expect(html).not.toContain('>Triage</span>');
  });

  it.each(['settings', 'settings/privacy', 'settings/help', 'billing'])(
    'has exactly one account destination selected for %s',
    (active) => {
      const html = render({ active, responsive: true, collapsed: false });
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toContain(
        `aria-label="${active === 'billing' ? 'Plan &amp; billing' : 'Settings'}" aria-current="page"`,
      );
    },
  );

  it('assigns visible destinations once and retains legacy review aliases in Cleanup', () => {
    expect(NAV.map((item) => item.id)).toEqual(routes);
    const grouped = ['home', 'senders', 'triage', 'screener', ...routes.slice(2)];
    if (CATCH_UP_LATER_FIRST) {
      const briefAt = grouped.indexOf('brief');
      grouped.splice(briefAt, 3, 'snoozed', 'brief', 'followups');
    }
    expect(WORKSPACE_NAV.flatMap((item) => [...item.members])).toEqual(grouped);
    expect(WORKSPACE_NAV.find((item) => item.id === 'senders')?.members[0]).toBe('senders');
    expect(WORKSPACE_NAV.find((item) => item.id === 'autopilot')?.members[0]).toBe('autopilot');
    expect(WORKSPACE_NAV.find((item) => item.id === 'brief')?.members[0]).toBe(
      CATCH_UP_LATER_FIRST ? 'snoozed' : 'brief',
    );
    for (const route of routes) {
      const html = render({ active: route });
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      const group = workspaceSection(route)!;
      expect(html).toContain(`aria-current="page" aria-label="${group.label}"`);
    }
    expect(workspaceSection('billing')).toBeUndefined();
  });

  it('exposes child counts and gates without changing the group name', () => {
    const html = render({
      counts: { screener: { text: 7, label: '7 senders awaiting first review' }, senders: 0 },
      locks: { brief: 'Pro' },
    });
    expect(html).toContain(
      'aria-label="Cleanup" aria-description="Senders: 0 · 7 senders awaiting first review"',
    );
    expect(html).toContain('data-testid="nav-dot-senders"');
    expect(html).toContain(
      'aria-label="Catch up" aria-describedby="nav-catchup-hint" aria-description="Daily Brief: Pro feature"',
    );
    expect(html).not.toContain('data-testid="nav-dot-brief"');
    expect(render({ counts: { senders: 0, triage: '0' } })).not.toContain('nav-dot-senders');
  });

  it('uses review names in Cleanup hints for counts and gates', () => {
    const html = render({ counts: { triage: 4 }, locks: { screener: 'Plus' } });
    expect(html).toContain('Guided Review: 4');
    expect(html).toContain('Needs first review: Plus feature');
    expect(html).not.toContain('Triage:');
    expect(html).not.toContain('Screener:');
  });

  it.each(['triage', 'screener'])(
    'keeps Cleanup active for legacy %s aliases without another tab',
    (active) => {
      const html = render({ active });
      expect(html).toContain('aria-current="page" aria-label="Cleanup"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).not.toContain('aria-label="Triage"');
      expect(html).not.toContain('aria-label="Screener"');
    },
  );

  it('retains the complete labelled mobile drawer and real count/gate labels', () => {
    const html = render({
      collapsed: false,
      counts: { senders: { text: 7, label: '7 senders' } },
      locks: { brief: 'Pro' },
    });
    for (const label of labels) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('aria-label="7 senders"');
    expect(html).not.toContain('>Triage</span>');
    expect(html).not.toContain('>Screener</span>');
    expect(html).toContain('aria-label="Pro feature"');
    expect(html).toContain('>7</span>');
  });
});

describe('SectionNavigation', () => {
  it.each([
    [
      'snoozed',
      'Catch up views',
      CATCH_UP_LATER_FIRST
        ? ['Later', 'Daily Brief', 'Follow-ups']
        : ['Daily Brief', 'Follow-ups', 'Later'],
    ],
  ])('exposes the complete contextual group for %s', (active, name, expectedLabels) => {
    const html = renderToStaticMarkup(
      <SectionNavigation active={active as string} onNavigate={() => {}} />,
    );
    expect(html).toContain(`aria-label="${name}"`);
    for (const label of expectedLabels) expect(html).toContain(`>${label}</button>`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it('keeps exact child counts and entitlement labels', () => {
    const html = renderToStaticMarkup(
      <SectionNavigation
        active="brief"
        onNavigate={() => {}}
        counts={{ brief: { text: 7, label: '7 briefs' } }}
        locks={{ brief: 'Pro' }}
      />,
    );
    expect(html).toContain('aria-label="7 briefs"');
    expect(html).toContain('aria-label="Pro feature"');
  });
  it.each([
    'autopilot',
    'quiet',
    'home',
    'senders',
    'triage',
    'screener',
    'activity',
    'settings',
    'billing',
  ])('omits redundant context for %s', (active) => {
    expect(renderToStaticMarkup(<SectionNavigation active={active} onNavigate={() => {}} />)).toBe(
      '',
    );
  });
});
