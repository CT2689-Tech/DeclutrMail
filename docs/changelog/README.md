# Changelog source (D218)

Public `/changelog` currently ships a thin hardcoded list in
`apps/web/src/app/(marketing)/changelog/page.tsx`.

Future releases should move to markdown files in this directory (one
file per release) and be rendered by the marketing route. Until that
pipeline exists, update the page component when something material
ships — do not invent version numbers or day-precision dates without a
release record.
