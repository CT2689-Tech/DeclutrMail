// JSON-LD structured-data emitter (D132 SEO batch).
//
// Server component — renders a `<script type="application/ld+json">`
// data block. Data blocks are never executed, so the D175 CSP
// (script-src 'strict-dynamic' + nonce) does not apply to them; no
// nonce plumbing is needed here.
//
// `<` is escaped per the Next.js JSON-LD guidance so a string value
// can never break out of the script element. All data comes from our
// own modules today; the escape is defense in depth.

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
