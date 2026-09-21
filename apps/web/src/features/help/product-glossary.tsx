'use client';

import { ScreenIntro, tokens, useIsAtMost } from '@declutrmail/shared';

import { DrillRow, PageHeader, SettingsGroup } from '@/features/settings/settings-list';
import { GLOSSARY_GROUPS, GLOSSARY_TERMS, type GlossaryTermId } from './glossary-content';

const { color, font, text } = tokens;

/** D245's compact, authenticated product glossary. */
export function ProductGlossary() {
  return (
    <div
      className="dm-settings-page"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
        fontFamily: font.sans,
      }}
    >
      <style>{`@media (max-width: 480px) { .dm-settings-page { padding-left: 16px !important; padding-right: 16px !important; } }`}</style>
      <PageHeader title="Help & glossary" backToSettings />
      <ScreenIntro
        id="product-glossary"
        title="Help & glossary"
        body="What each control and recovery path in DeclutrMail means."
        learnMore={{ href: '/help', label: 'Browse Help & FAQ' }}
      />

      {GLOSSARY_GROUPS.map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          <dl style={{ margin: 0 }}>
            {group.terms.map((id) => (
              <GlossaryEntry key={id} id={id} />
            ))}
          </dl>
        </SettingsGroup>
      ))}

      <SettingsGroup title="More help">
        <DrillRow href="/help" label="Help & FAQ" />
      </SettingsGroup>
    </div>
  );
}

function GlossaryEntry({ id }: { id: GlossaryTermId }) {
  const entry = GLOSSARY_TERMS[id];
  const isPhone = useIsAtMost('xs');
  return (
    <div
      id={id}
      className="dm-settings-row"
      style={{
        display: 'grid',
        gap: isPhone ? 2 : 16,
        gridTemplateColumns: isPhone ? '1fr' : 'minmax(130px, 0.34fr) minmax(0, 1fr)',
        padding: '14px 16px',
        scrollMarginTop: 20,
      }}
    >
      <dt style={{ color: color.fg, fontSize: text.md, fontWeight: 500 }}>{entry.term}</dt>
      <dd style={{ color: color.fgMuted, fontSize: text.sm, lineHeight: 1.6, margin: 0 }}>
        {entry.definition}
      </dd>
    </div>
  );
}
