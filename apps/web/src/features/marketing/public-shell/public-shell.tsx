import Link from 'next/link';

import { PrivacyBadge } from '@declutrmail/shared';

import { oauthStartUrl } from '../landing/urls';
import { TrackedCta } from '../landing/tracked-cta';
import { PublicMobileMenu } from './public-mobile-menu';

const PRODUCT_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/inbox-simulator', label: 'Demo' },
  { href: '/methodology', label: 'Methodology' },
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
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    label: 'Learn',
    links: [
      { href: '/methodology', label: 'Methodology' },
      { href: '/compare', label: 'Compare' },
      { href: '/blog', label: 'Guides' },
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
      { href: '/cookies', label: 'Cookie choices' },
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
            <span className="dm-public-brand-mark" aria-hidden="true">
              D
            </span>
            <span>DeclutrMail</span>
          </Link>

          <nav className="dm-public-nav" aria-label="Primary navigation">
            {PRODUCT_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="dm-public-actions">
            <Link className="dm-public-sign-in" href="/sign-in">
              Sign in
            </Link>
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
            <span className="dm-public-brand-mark" aria-hidden="true">
              D
            </span>
            <span>DeclutrMail</span>
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
