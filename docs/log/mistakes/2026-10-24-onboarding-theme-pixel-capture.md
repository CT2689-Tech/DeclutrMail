# Rounded theme colors do not prove the final paint

**Caught by:** Merge-queue browser check for PR #1122.

The initial PR run passed six onboarding appearance cases. The queue then
failed two exact dark-mode screenshot comparisons. The trace shows a capture
127ms after a theme change whose transition lasts 160ms. Computed RGB values
had rounded to the expected endpoint before the final paint stopped changing.

Finish finite animations when capturing both sides of a static paint
comparison (`animations: 'disabled'`). Keep the exact pixel assertion and
selection checks; do not add retries or weaken thresholds. Production styles
and motion did not need a change.
