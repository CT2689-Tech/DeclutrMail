import Link from 'next/link';

import { Logo, PrivacyBadge } from '@declutrmail/shared';

import { oauthStartUrl } from '../landing/urls';
import { TrackedCta } from '../landing/tracked-cta';
import { PublicMobileMenu } from './public-mobile-menu';
import { PublicNavLinks } from './public-nav-links';

const PRODUCT_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/inbox-simulator', label: 'Demo' },
  { href: '/methodology', label: 'Privacy & control' },
  { href: '/compare', label: 'Compare' },
  { href: '/pricing', label: 'Pricing' },
] as const;

const FOOTER_GROUPS = [
  {
    label: 'Product',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/inbox-simulator', label: 'Inbox simulator' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/beta', label: 'Open beta' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    label: 'Learn',
    links: [
      { href: '/methodology', label: 'Privacy & control' },
      { href: '/compare', label: 'Compare' },
      { href: '/how-to', label: 'Guides' },
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
] as const;

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
              href={oauthStartUrl()}
              cta="connect_gmail"
              placement="nav_sign_in"
            >
              Sign in
            </TrackedCta>
            <TrackedCta
              className="dm-public-start"
              href={oauthStartUrl()}
              cta="connect_gmail"
              placement="nav"
            >
              Get started <span aria-hidden="true">→</span>
            </TrackedCta>
          </div>

          <PublicMobileMenu links={PRODUCT_LINKS} startUrl={oauthStartUrl()} />
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
          <PrivacyBadge variant="inline" />
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
