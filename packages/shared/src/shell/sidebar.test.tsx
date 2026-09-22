import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NAV, Sidebar, SectionNavigation, WORKSPACE_NAV, workspaceSection } from './sidebar';

const routes = [
  'home',
  'senders',
  'triage',
  'screener',
  'autopilot',
  'quiet',
  'brief',
  'followups',
  'snoozed',
  'activity',
];
const labels = [
  'Home',
  'Senders',
  'Triage',
  'Screener',
  'Autopilot',
  'Quiet',
  'Brief',
  'Follow-ups',
  'Later',
  'Activity',
];
const groups = ['Overview', 'Clean up', 'Automations', 'Catch up', 'Activity'];
const render = (props: Partial<Parameters<typeof Sidebar>[0]> = {}) =>
  renderToStaticMarkup(<Sidebar active="senders" onNavigate={() => {}} collapsed {...props} />);

describe('Sidebar — approved workspace rail', () => {
  it('renders five named groups in order at 72px, plus brand and settings', () => {
    const html = render();
    expect(html).toContain('width:72px');
    let position = -1;
    for (const name of groups) {
      const next = html.indexOf(`aria-label="${name}"`);
      expect(next).toBeGreaterThan(position);
      position = next;
    }
    expect(html).toContain('aria-label="DeclutrMail overview"');
    expect(html).toContain('aria-label="Workspace settings"');
    expect(html).not.toContain('Expand sidebar');
    expect(html).not.toContain('Collapse sidebar');
  });

  it('assigns every real feature to exactly one group without dropping routes', () => {
    expect(NAV.map((item) => item.id)).toEqual(routes);
    expect(WORKSPACE_NAV.flatMap((item) => [...item.members])).toEqual(routes);
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
      counts: { screener: { text: 7, label: '7 new senders waiting in Screener' }, senders: 0 },
      locks: { brief: 'Pro' },
    });
    expect(html).toContain(
      'aria-label="Clean up" aria-description="Senders: 0 · 7 new senders waiting in Screener"',
    );
    expect(html).toContain('data-testid="nav-dot-senders"');
    expect(html).toContain('aria-label="Catch up" aria-description="Brief: Pro feature"');
    expect(html).not.toContain('data-testid="nav-dot-brief"');
    expect(render({ counts: { senders: 0, triage: '0' } })).not.toContain('nav-dot-senders');
  });

  it('retains the complete labelled mobile drawer and real count/gate labels', () => {
    const html = render({
      collapsed: false,
      counts: { screener: { text: 7, label: '7 new senders waiting in Screener' } },
      locks: { brief: 'Pro' },
    });
    for (const label of labels) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('aria-label="7 new senders waiting in Screener"');
    expect(html).toContain('aria-label="Pro feature"');
    expect(html).toContain('>7</span>');
  });
});

describe('SectionNavigation', () => {
  it.each([
    ['screener', 'Clean up views', ['Senders', 'Triage', 'Screener']],
    ['quiet', 'Automations views', ['Autopilot', 'Quiet']],
    ['snoozed', 'Catch up views', ['Brief', 'Follow-ups', 'Later']],
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
        active="triage"
        onNavigate={() => {}}
        counts={{ screener: { text: 7, label: '7 new senders' } }}
        locks={{ screener: 'Pro' }}
      />,
    );
    expect(html).toContain('aria-label="7 new senders"');
    expect(html).toContain('aria-label="Pro feature"');
  });
  it.each(['home', 'activity', 'settings', 'billing'])(
    'omits redundant context for %s',
    (active) => {
      expect(
        renderToStaticMarkup(<SectionNavigation active={active} onNavigate={() => {}} />),
      ).toBe('');
    },
  );
});
