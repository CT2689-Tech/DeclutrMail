import { WS5_COPY } from '@declutrmail/shared/copy/launch';

/**
 * Home reads WS5 at render time. The module is `{}` until the Inbox
 * Report deck lands, and a missing key means the surface renders nothing.
 */
function read(key: string): unknown {
  if (typeof WS5_COPY !== 'object' || WS5_COPY === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(WS5_COPY, key)) return undefined;
  return (WS5_COPY as Record<string, unknown>)[key];
}

export function ws5Text(key: string): string | null {
  const value = read(key);
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function ws5Plural(key: string): { one: string; other: string } | null {
  const value = read(key);
  if (typeof value !== 'object' || value === null) return null;
  const row = value as { one?: unknown; other?: unknown };
  if (typeof row.one !== 'string' || row.one.trim() === '') return null;
  if (typeof row.other !== 'string' || row.other.trim() === '') return null;
  return { one: row.one, other: row.other };
}

export interface HomeReportCopy {
  title: string;
  body: string;
  cta: string;
  trust: string;
  trustLink: string | null;
}

/** Report slot. Absent until title, body, cta, and the trust line all exist. */
export function homeReportCopy(): HomeReportCopy | null {
  const title = ws5Text('report.home.title');
  const body = ws5Text('report.home.body');
  const cta = ws5Text('report.home.cta');
  const trust = ws5Text('report.trust');
  if (title === null || body === null || cta === null || trust === null) return null;
  return { title, body, cta, trust, trustLink: ws5Text('report.trust.link') };
}

export function homeCalmTemplate(): string | null {
  return ws5Text('report.fallback.zero');
}

export interface HomeTileCopy {
  value: string;
  label: string;
  note: string | null;
}

/** The size figure and the sentence that names it. Never one without the other. */
export function homeTileCopy(): HomeTileCopy | null {
  const value = ws5Text('f2.homeTile.value');
  const label = ws5Text('f2.homeTile.label');
  if (value === null || label === null) return null;
  return { value, label, note: ws5Text('report.sizesNote') ?? ws5Text('f2.estimates') };
}

export interface HomeFixCopy {
  headingOne: string;
  headingOther: string;
  primaryOne: string;
  primaryOther: string;
  review: string;
  supportOne: string;
  supportOther: string;
  titleOne: string;
  titleOther: string;
  titleBulkOne: string;
  titleBulkOther: string;
  emailsOne: string;
  emailsOther: string;
  button: string;
  cancel: string;
  honesty: string;
}

/**
 * Unsubscribe step and its confirm dialog. The headline is the sentence
 * that names the senders the step counts, so the step stays hidden until
 * that sentence exists too.
 */
export function homeFixCopy(): HomeFixCopy | null {
  const heading = ws5Plural('report.fix.heading');
  const primary = ws5Plural('report.fix.primary');
  const support = ws5Plural('report.mostlyUnread.support');
  const title = ws5Plural('f1.title.archive');
  const review = ws5Text('report.fix.review');
  const titleBulk = ws5Plural('f1.title.bulk.archive');
  const emails = ws5Plural('f1.part.emails');
  const button = ws5Text('f1.button.archive');
  const cancel = ws5Text('f1.button.cancel');
  const honesty = ws5Text('f1.honesty.archive');
  if (
    heading === null ||
    primary === null ||
    support === null ||
    title === null ||
    review === null ||
    titleBulk === null ||
    emails === null ||
    button === null ||
    cancel === null ||
    honesty === null ||
    !homeReportNamesSenders()
  ) {
    return null;
  }
  return {
    headingOne: heading.one,
    headingOther: heading.other,
    primaryOne: primary.one,
    primaryOther: primary.other,
    review,
    supportOne: support.one,
    supportOther: support.other,
    titleOne: title.one,
    titleOther: title.other,
    titleBulkOne: titleBulk.one,
    titleBulkOther: titleBulk.other,
    emailsOne: emails.one,
    emailsOther: emails.other,
    button,
    cancel,
    honesty,
  };
}

export function homeReportNamesSenders(): boolean {
  return (
    ws5Plural('report.mostlyUnread.headline') !== null ||
    ws5Text('report.mostlyUnread.headline.all') !== null
  );
}
