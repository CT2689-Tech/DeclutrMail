'use client';

import {
  editorialColumnStyle,
  EditorialKicker,
  EditorialContents,
} from '@/features/editorial/page';

import { useState } from 'react';

import { ScreenIntro } from '@declutrmail/shared';

import { PageHeader, SettingsGroup } from '@/features/settings/settings-list';
import { GLOSSARY_GROUPS, GLOSSARY_TERMS, type GlossaryTermId } from './glossary-content';

import styles from './product-glossary.module.css';

/** D245's compact, authenticated product glossary. */
export function ProductGlossary() {
  const [search, setSearch] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const groups = GLOSSARY_GROUPS.map((group) => ({
    ...group,
    terms: group.terms.filter((id) => {
      const entry = GLOSSARY_TERMS[id];
      return `${entry.term} ${entry.definition}`.toLocaleLowerCase().includes(term);
    }),
  })).filter((group) => group.terms.length > 0);
  return (
    <div
      className={`dm-settings-page ${styles.page}`}
      style={{ ...editorialColumnStyle, display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      <EditorialKicker>Your workspace / A useful reference</EditorialKicker>
      <PageHeader title="Help & glossary" backToSettings />
      <EditorialContents
        label="Help destinations"
        items={[
          { href: '#contact-support', label: 'Contact support' },
          { href: '/help', label: 'Help & FAQ' },
          { href: '/activity', label: 'Recover a change' },
        ]}
      />
      <ScreenIntro
        id="product-glossary"
        title="Help & glossary"
        body="What each control and recovery path in DeclutrMail means."
        learnMore={{ href: '/help', label: 'Browse Help & FAQ' }}
      />

      <label className={styles.search}>
        Search product terms
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Try unsubscribe, recovery, or rules"
          className={styles.input}
        />
      </label>
      {groups.length === 0 && (
        <p role="status" className={styles.empty}>
          No terms match “{search}”.{' '}
          <button type="button" onClick={() => setSearch('')} className={styles.clear}>
            Clear search
          </button>
        </p>
      )}
      {groups.map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          <dl style={{ margin: 0 }}>
            {group.terms.map((id) => (
              <GlossaryEntry key={id} id={id} />
            ))}
          </dl>
        </SettingsGroup>
      ))}
    </div>
  );
}

function GlossaryEntry({ id }: { id: GlossaryTermId }) {
  const entry = GLOSSARY_TERMS[id];
  return (
    <div id={id} className={`dm-settings-row ${styles.entry}`}>
      <dt>{entry.term}</dt>
      <dd>{entry.definition}</dd>
    </div>
  );
}
