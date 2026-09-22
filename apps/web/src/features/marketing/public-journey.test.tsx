import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HowItWorksPage from '@/app/(marketing)/how-it-works/page';
import MethodologyPage from '@/app/(marketing)/methodology/page';
import { ProductJourney } from './landing/product-journey';
import { AuthEntry } from './auth-entry/auth-entry';
import { permissionEntryUrl, safePublicReturnTo } from './landing/urls';
import { ArticlePage } from './learn/article-page';
import HelpPage from '@/app/(marketing)/help/page';
import { FAQ_ENTRIES } from './learn/faq-content';
import { GLOSSARY_TERMS } from '@/features/help/glossary-content';
import { HOW_TO_ARTICLES } from './learn/how-to-content';
import { ANSWER_ARTICLES } from './learn/answer-content';
import { BLOG_ARTICLES } from './learn/blog-content';
import { GUIDED_SCENARIOS } from './inbox-simulator/inbox-simulator-screen';
import { demoForTopic } from './learn/journey-links';
import { COMPARISONS, ALTERNATIVES_SLUGS, alternativesFor } from './comparison/comparison-data';
import { ComparisonDetailScreen } from './comparison/comparison-screen';
import { AlternativesScreen } from './comparison/alternatives-screen';

vi.mock('@/lib/posthog', () => ({ track: vi.fn(async () => undefined) }));

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('rendered public promises and product entry', () => {
  it('states Screener delivery and the inline Keep exception in rendered story pages', () => {
    const story = text(renderToStaticMarkup(<HowItWorksPage />));
    expect(story).toContain('while their email still arrives in Gmail');
    expect(story).toContain('Keep is an inline sender decision');
    for (const group of ['Overview', 'Clean up', 'Automations', 'Activity'])
      expect(story).toContain(group);
    expect(story).not.toMatch(/instead of dropping|before anything changes/);
    const methodology = text(renderToStaticMarkup(<MethodologyPage />));
    expect(methodology).toContain('Mail-moving actions wait for their preview');
    expect(methodology).toContain('without a separate confirmation each time');
  });

  it('teaches Trash and unsubscribe boundaries in the rendered simulator lesson', () => {
    const lesson = GUIDED_SCENARIOS[3]!;
    const rendered = text(
      renderToStaticMarkup(
        <section>
          <p>{lesson.body}</p>
          <p>{lesson.prompt}</p>
        </section>,
      ),
    );
    expect(rendered).toContain('Unsubscribe alone moves no existing email');
    expect(rendered).toContain('storage is freed only after permanent deletion in Gmail');
    expect(rendered).not.toMatch(/actually clears space|unsubscribed so far only left/);
  });

  it('labels the illustrative walkthrough and explains the complete product journey', () => {
    render(<ProductJourney />);
    expect(screen.getByText(/Illustrative walkthrough · made-up data/)).toBeInTheDocument();
    expect(screen.getByText(/not your mailbox/)).toBeInTheDocument();
    expect(screen.getByText(/Keep is an inline decision/)).toBeInTheDocument();
    expect(
      screen.getByText(/Delivered unsubscribe requests cannot be recalled/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Try the interactive demo/ })).toHaveAttribute(
      'href',
      '/inbox-simulator?step=1',
    );
    expect(screen.getByRole('radio', { name: '1. Inspect' })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('retains valid checkout intent through the permission checkpoint and final OAuth hop', () => {
    const intent = '/billing?plan=pro&cycle=annual&promo=foundingPro';
    const entry = new URL(permissionEntryUrl(intent), 'https://declutrmail.test');
    expect(entry.pathname).toBe('/sign-in');
    expect(entry.searchParams.get('returnTo')).toBe(intent);
    render(<AuthEntry returnTo={safePublicReturnTo(intent)!} />);
    const final = new URL(
      screen.getByRole('link', { name: 'Continue with Google' }).getAttribute('href')!,
      'https://declutrmail.test',
    );
    expect(final.pathname).toBe('/api/auth/google/start');
    expect(final.searchParams.get('returnTo')).toBe(intent);
  });

  it.each([
    'https://evil.test',
    '//evil.test',
    '/billing?plan=pro&cycle=annual&next=evil',
    '/billing?plan=free&cycle=monthly',
    '/billing?plan=pro&cycle=annual#evil',
    '/billing?plan=pro&plan=plus&cycle=annual',
  ])('rejects unsupported return intent %s', (value) => {
    expect(permissionEntryUrl(value)).toBe('/sign-in');
  });
});

describe('every shared public content variant has a usable next step', () => {
  const articles = [
    ...Object.values(HOW_TO_ARTICLES),
    ...Object.values(ANSWER_ARTICLES),
    ...Object.values(BLOG_ARTICLES),
  ];
  it.each(articles)(
    '$path has a hub breadcrumb, mobile contents and a task-matched demo',
    (article) => {
      const { container } = render(<ArticlePage article={article} />);
      const crumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      expect(crumb.getAllByRole('link')).toHaveLength(2);
      expect(container.querySelector('.dm-otp-mobile summary')).toHaveTextContent('On this page');
      expect(screen.getByRole('link', { name: demoForTopic(article.slug).label })).toHaveAttribute(
        'href',
        demoForTopic(article.slug).href,
      );
    },
  );
  it.each(COMPARISONS)('/vs/$slug preserves sources and offers a relevant demo', (comparison) => {
    render(<ComparisonDetailScreen comparison={comparison} />);
    expect(screen.getByRole('link', { name: demoForTopic(comparison.slug).label })).toHaveAttribute(
      'href',
      demoForTopic(comparison.slug).href,
    );
    for (const source of comparison.sources)
      expect(screen.getByRole('link', { name: source.label })).toHaveAttribute('href', source.url);
  });
  it.each(ALTERNATIVES_SLUGS)('/alternatives/%s keeps the subject and task example', (slug) => {
    const page = alternativesFor(slug)!;
    render(<AlternativesScreen page={page} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(page.subject.name);
    expect(screen.getByRole('link', { name: demoForTopic(slug).label })).toHaveAttribute(
      'href',
      demoForTopic(slug).href,
    );
  });
});

describe('truthful Watch first activation guidance', () => {
  it('renders both optional watching and immediate activation without a required wait', () => {
    const guide = text(
      renderToStaticMarkup(
        <ArticlePage article={HOW_TO_ARTICLES['auto-archive-future-emails-in-gmail']!} />,
      ),
    );
    expect(guide).toContain('choose Act now for automatic actions or Watch first');
    expect(guide).toContain('There is no mandatory waiting period');
    expect(guide).toContain('does not automatically activate the rule');
    expect(guide).not.toMatch(/Every preset begins in|After seven days, you review/);
  });

  it('uses the same visible mode name in Help, FAQ, articles and the stable glossary anchor', () => {
    const help = text(renderToStaticMarkup(<HelpPage />));
    expect(help).toContain('Watch first and Active');
    const content = JSON.stringify([FAQ_ENTRIES, HOW_TO_ARTICLES, ANSWER_ARTICLES, BLOG_ARTICLES]);
    expect(content).not.toMatch(/Observe (?:mode|only|before)|in Observe|begins in Observe/);
    expect(GLOSSARY_TERMS.observe.term).toBe('Watch first');
    expect(GLOSSARY_TERMS.observe.definition).toContain('never switches to Active automatically');
    expect(GLOSSARY_TERMS.rule.definition).toContain('Watch first');
  });
});

describe('mobile story table label boundaries', () => {
  it('repeats decision column headers while keeping processor row headers independent', () => {
    const { container, unmount } = render(<HowItWorksPage />);
    const table = container.querySelector('.dm-story-table')!;
    const headers = Array.from(table.querySelectorAll('thead th'))
      .slice(1)
      .map((header) => header.textContent);
    for (const row of table.querySelectorAll('tbody tr')) {
      expect(
        Array.from(row.querySelectorAll('td')).map((cell) => cell.getAttribute('data-label')),
      ).toEqual(headers);
    }
    unmount();
    const methodology = render(<MethodologyPage />).container;
    const processorTable = methodology.querySelector('.dm-story-table')!;
    expect(
      Array.from(processorTable.querySelectorAll('th[scope="row"]')).map(
        (header) => header.textContent,
      ),
    ).toEqual(['Sent for the Brief', 'Never sent for the Brief']);
    expect(processorTable.querySelector('td[data-label]')).toBeNull();
  });
});
