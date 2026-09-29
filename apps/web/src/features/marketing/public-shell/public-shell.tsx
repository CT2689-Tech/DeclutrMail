import Link from 'next/link';

import { Logo } from '@declutrmail/shared';
import { ThemeToggle } from '@/features/theme/theme-toggle';
import { isFeatureEnabled } from '@/lib/flags';

import { ALTERNATIVES_SLUGS, COMPARISONS, alternativesFor } from '../comparison/comparison-data';
import { permissionEntryUrl } from '../landing/urls';
import { TrackedCta } from '../landing/tracked-cta';
import { HOW_TO_ARTICLES, HOW_TO_SLUGS } from '../learn/how-to-content';
import { PublicMobileMenu } from './public-mobile-menu';
import { PublicNavLinks } from './public-nav-links';

// Keep the main decision routes visible; the footer remains the full site directory.
const PRODUCT_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/inbox-simulator', label: 'Demo' },
  { href: '/compare', label: 'Compare' },
  { href: '/methodology', label: 'Privacy & control' },
] as const;

const COMPARE_LINKS = [
  { href: '/compare', label: 'All comparisons' },
  ...COMPARISONS.map((comparison) => ({
    href: `/vs/${comparison.slug}`,
    label: comparison.title,
  })),
  ...ALTERNATIVES_SLUGS.flatMap((slug) => {
    const page = alternativesFor(slug);
    if (!page) return [];
    return [{ href: `/alternatives/${slug}`, label: `${page.subject.name} alternatives` }];
  }),
];

const GUIDE_LINKS = [
  { href: '/how-to', label: 'All how-to guides' },
  ...HOW_TO_SLUGS.map((slug) => ({
    href: HOW_TO_ARTICLES[slug].path,
    label: HOW_TO_ARTICLES[slug].title,
  })),
];

const FOOTER_GROUPS = [
  {
    label: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/inbox-simulator', label: 'Inbox simulator' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/beta', label: 'Open beta' },
    ],
  },
  {
    label: 'Compare',
    links: COMPARE_LINKS,
  },
  {
    label: 'Guides',
    links: GUIDE_LINKS,
  },
  {
    label: 'Learn',
    links: [
      { href: '/methodology', label: 'Privacy & control' },
      { href: '/answers', label: 'Answers' },
      { href: '/blog', label: 'Articles' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
  {
    label: 'Trust',
    links: [
      { href: '/security', label: 'Security' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/refunds', label: 'Refunds' },
    ],
  },
  {
    label: 'Support',
    links: [
      { href: '/help', label: 'Help' },
      { href: '/contact', label: 'Contact' },
      { href: '/cookies', label: 'Cookie preferences' },
    ],
  },
];

export function PublicHeader() {
  return (
    <>
      <a className="dm-public-skip" href="#main-content">
        Skip to content
      </a>
      <header className="dm-public-header">
        <div className="dm-public-header-inner">
          <Link href="/" className="dm-public-brand" aria-label="DeclutrMail home">
            <Logo size={27} label={null} />
          </Link>

          <nav className="dm-public-nav" aria-label="Primary navigation">
            <PublicNavLinks links={PRODUCT_LINKS} />
          </nav>

          <div className="dm-public-actions">
            <TrackedCta
              className="dm-public-sign-in"
              href={permissionEntryUrl()}
              cta="connect_gmail"
              placement="nav_sign_in"
            >
              Sign in
            </TrackedCta>
            <TrackedCta
              className="dm-public-start"
              href={permissionEntryUrl()}
              cta="connect_gmail"
              placement="nav"
            >
              Start free
            </TrackedCta>
          </div>

          {isFeatureEnabled('darkMode') ? (
            <ThemeToggle className="dm-public-theme-toggle" showLabel />
          ) : null}
          <PublicMobileMenu links={PRODUCT_LINKS} startUrl={permissionEntryUrl()} />
        </div>
      </header>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="dm-public-footer">
      <div className="dm-public-footer-inner">
        <div className="dm-public-footer-intro">
          <Link href="/" className="dm-public-brand">
            <Logo size={27} />
          </Link>
          <p>Gmail stays your inbox. DeclutrMail helps you control it one sender at a time.</p>
        </div>

        <div className="dm-public-footer-groups">
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.label} aria-label={group.label}>
              <p>{group.label}</p>
              {group.links.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
      </div>
      <div className="dm-public-footer-fine">
        <span>© {new Date().getFullYear()} DeclutrMail</span>
        <span>Works with Gmail. Not affiliated with or endorsed by Google.</span>
      </div>
    </footer>
  );
}
