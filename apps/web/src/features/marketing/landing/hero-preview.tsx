import { ACTION_SEMANTICS, VERB_REGISTRY } from '@declutrmail/shared/actions';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

// Styles are loaded by the public route group through public-styles.css.

/** Fictional sample; the count matches the sender close-up below. */
const SAMPLE = { initials: 'fn', name: 'Fieldnotes', address: 'weekly@fieldnotes.example' };
const SAMPLE_COUNT = 128;

/**
 * The action preview a visitor would see before an Archive moves mail:
 * the count, where the email goes and how to undo it (D226), each once.
 * Facts come from the action semantics registry and the undo floor, so
 * the illustration cannot drift from the product's own preview.
 *
 * Decorative, not a control: the "buttons" are spans and nothing inside
 * is focusable. Screen readers get one label for the whole figure.
 */
export function HeroPreview() {
  const archive = ACTION_SEMANTICS.archive;
  const undo = `Undo from Activity for ${MIN_UNDO_WINDOW_DAYS} days.`;
  return (
    <figure className="dm-home-preview-figure">
      <div
        className="dm-home-preview"
        role="img"
        aria-label={`Illustrative ${archive.label} preview for a fictional sender, ${SAMPLE.name}: ${archive.label} ${SAMPLE_COUNT} emails. ${archive.currentMail.summary} ${undo}`}
      >
        <div aria-hidden="true" className="dm-home-preview-body">
          <div className="dm-home-preview-top">
            <span className="dm-home-preview-label">Preview · {archive.label}</span>
            <span className="dm-home-chip">Fictional sample</span>
          </div>
          <div className="dm-home-preview-sender">
            <span className="dm-home-avatar">{SAMPLE.initials}</span>
            <span>
              <strong>{SAMPLE.name}</strong>
              <small>{SAMPLE.address}</small>
            </span>
          </div>
          <p className="dm-home-preview-title">
            {archive.label} <span className="dm-home-num">{SAMPLE_COUNT}</span> emails
          </p>
          <ul className="dm-home-preview-facts">
            <li>
              <ArchiveGlyph />
              {archive.currentMail.summary}
            </li>
            <li>
              <UndoGlyph />
              {undo}
            </li>
          </ul>
          <div className="dm-home-preview-actions">
            <span className="dm-home-preview-cancel">Cancel</span>
            <span className="dm-home-preview-confirm">
              {archive.label} {SAMPLE_COUNT}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="dm-home-shortcuts">
        <span className="dm-home-visually-hidden">Keyboard shortcuts: </span>
        {VERB_REGISTRY.map((verb) => (
          <span key={verb.id} data-active={verb.id === 'archive' ? 'true' : undefined}>
            <kbd>{verb.shortcut}</kbd> {verb.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M2 3h20v4H2z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function UndoGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 7" />
    </svg>
  );
}
