'use client';

import Link from 'next/link';
import { Card, ScreenIntro, tokens } from '@declutrmail/shared';

import { GlossaryContextualHelp } from './contextual-help';
import { GLOSSARY_GROUPS, GLOSSARY_TERMS, type GlossaryTermId } from './glossary-content';

const { color, font, radius } = tokens;

/** D245's compact, authenticated product glossary. */
export function ProductGlossary() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 860,
        margin: '0 auto',
        padding: '24px 24px 40px',
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro
        id="product-glossary"
        title="Help & glossary"
        body="Short definitions for the controls and recovery paths you see in DeclutrMail. Action previews and Activity remain the source of truth for a specific change and its deadline."
        learnMoreHref="/help"
      />

      <div style={{ marginTop: 20 }}>
        <Link
          href="/settings"
          aria-label="Back to Settings"
          style={{ color: color.primary, fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}
        >
          ← Settings
        </Link>
        <h1
          style={{
            color: color.fg,
            fontFamily: font.display,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '-0.018em',
            margin: '12px 0 6px',
          }}
        >
          Product glossary
        </h1>
        <p style={{ color: color.fgSoft, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
          Nine terms that explain what DeclutrMail knows, what it can change, and where recovery
          lives.
        </p>
      </div>

      <nav
        aria-label="Glossary topics"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '18px 0' }}
      >
        {GLOSSARY_GROUPS.map((group) => (
          <a
            key={group.title}
            href={`#${group.terms[0]}`}
            style={{
              border: `1px solid ${color.line}`,
              borderRadius: radius.pill,
              color: color.fgSoft,
              fontSize: 11.5,
              padding: '5px 9px',
              textDecoration: 'none',
            }}
          >
            {group.title}
          </a>
        ))}
      </nav>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {GLOSSARY_GROUPS.map((group) => (
          <Card key={group.title} padding={0}>
            <section aria-labelledby={`group-${group.terms[0]}`} style={{ padding: '18px 20px' }}>
              <h2
                id={`group-${group.terms[0]}`}
                style={{ color: color.fg, fontSize: 15, fontWeight: 600, margin: 0 }}
              >
                {group.title}
              </h2>
              <p
                style={{ color: color.fgMuted, fontSize: 12.5, lineHeight: 1.5, margin: '4px 0 0' }}
              >
                {group.description}
              </p>
              <dl style={{ margin: '14px 0 0' }}>
                {group.terms.map((id, index) => (
                  <GlossaryEntry key={id} id={id} divided={index > 0} />
                ))}
              </dl>
            </section>
          </Card>
        ))}
      </div>

      <aside aria-label="Common product distinctions" style={{ marginTop: 18 }}>
        <h2 style={{ color: color.fg, fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>
          Common distinctions
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <GlossaryContextualHelp
            question="Protected or VIP — which should I use?"
            termIds={['protected', 'vip']}
          />
          <GlossaryContextualHelp
            question="Observe or Active — is Gmail changing?"
            termIds={['observe', 'active']}
          />
          <GlossaryContextualHelp
            question="Activity Undo or Gmail Trash recovery — where do I go?"
            termIds={['activityUndo', 'gmailTrashRecovery']}
          />
        </div>
      </aside>

      <p style={{ color: color.fgMuted, fontSize: 12.5, lineHeight: 1.6, margin: '20px 0 0' }}>
        Need account or privacy help? See the public{' '}
        <Link href="/help" style={{ color: color.primary }}>
          Help &amp; FAQ
        </Link>{' '}
        or email{' '}
        <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
          support@declutrmail.com
        </a>
        .
      </p>
    </div>
  );
}

function GlossaryEntry({ id, divided }: { id: GlossaryTermId; divided: boolean }) {
  const entry = GLOSSARY_TERMS[id];
  return (
    <div
      id={id}
      style={{
        borderTop: divided ? `1px solid ${color.lineSoft}` : undefined,
        display: 'grid',
        gap: 4,
        gridTemplateColumns: 'minmax(130px, 0.34fr) minmax(0, 1fr)',
        padding: divided ? '13px 0 0' : 0,
        marginTop: divided ? 13 : 0,
        scrollMarginTop: 20,
      }}
    >
      <dt style={{ color: color.fg, fontSize: 13, fontWeight: 600 }}>{entry.term}</dt>
      <dd style={{ color: color.fgSoft, fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
        {entry.definition}
      </dd>
    </div>
  );
}
