/** One row in a page's table of contents; `id` is the section anchor. */
export interface OnThisPageItem {
  readonly id: string;
  readonly label: string;
}

/**
 * "On this page" for the reading template (`reading.css`).
 *
 * Server-rendered, no client JS. On >=1200px the parent's `.dm-read--rail`
 * grid lifts this same element into a sticky left rail; below that it
 * sits inline above the body — or, with `narrow="hidden"`, only exists on
 * the rail (articles, where the short answer should come first on a phone).
 */
export function OnThisPage({
  items,
  narrow = 'list',
}: {
  items: readonly OnThisPageItem[];
  narrow?: 'list' | 'hidden';
}) {
  const links = (
    <ol>
      {items.map(({ id, label }) => (
        <li key={id}>
          <a href={`#${id}`}>{label}</a>
        </li>
      ))}
    </ol>
  );
  return (
    <nav
      aria-label="On this page"
      className={`dm-otp${narrow === 'hidden' ? ' dm-otp--article' : ''}`}
    >
      <div className="dm-otp-desktop">
        <p className="dm-otp-title">On this page</p>
        {links}
      </div>
      <details className="dm-otp-mobile">
        <summary>On this page</summary>
        {links}
      </details>
    </nav>
  );
}

/** Pages with more than four h2s are long enough to earn the rail. */
export const RAIL_MIN_SECTIONS = 5;
