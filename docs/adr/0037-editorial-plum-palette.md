# ADR-0037: Editorial plum across product and marketing

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decider:** Product owner, in the homepage visual review
- **Related:** ADR-0036 (logo geometry and colour specification)

## Context

The product and public pages used teal as their primary identity. A visual study compared editorial, product-first and guided-story homepage layouts with plum, cobalt and forest palettes in light and dark themes. The product owner selected the editorial stage with plum and asked for that direction to be implemented.

## Decision

Use warm paper, dark ink and restrained plum as the shared visual system across the public site and application. The homepage opens with a generous editorial promise and a visible sender workspace with its right-hand details panel. Use the same palette for the brand mark, generated icons, social preview images and manifest so the identity remains consistent outside the browser. Keep green, amber and red for status meanings rather than using green as the general brand accent.

The logo geometry, wordmark typography, two-cut sizing and tone behaviour remain as specified in ADR-0036. Its literal colour set becomes ink `#2D2630`, plum `#59415F`, lilac `#D1B8D6` on dark surfaces, and paper `#FAF4ED`. Other interface colours continue to come from shared theme tokens.

The sender workspace shown on the public homepage is illustrative, with fictional data and no interactive controls. Product actions remain in the signed-in application and the guided demo.
