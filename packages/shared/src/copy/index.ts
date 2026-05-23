// @declutrmail/shared/copy — canonical user-facing copy modules.
//
// Importers should pull from here (or the named submodule) rather
// than inlining strings, so the microcopy audit hooks (D194/D209/D228)
// only have to guard a single source of truth.

export {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_BADGE_LEAD,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
  GMAIL_PREVIEW_FIELD_LABEL,
} from './privacy';
