# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a11y-smoke.spec.ts >> keyboard shortcut dialog traps and restores focus
- Location: specs/a11y-smoke.spec.ts:139:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'Keyboard shortcuts' })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog', { name: 'Keyboard shortcuts' }) with timeout 15000ms
  - waiting for getByRole('dialog', { name: 'Keyboard shortcuts' })

```

```yaml
- main:
    - navigation "Primary":
        - button "Overview"
        - button "Clean up"
        - button "Automations"
        - button "Catch up"
        - button "Activity"
    - button "Open navigation menu"
    - strong: Clean up
    - button "About this screen": '?'
    - button "Switch to dark mode"
    - button "Check Gmail for new emails"
    - tooltip "Sync now"
    - button "chintan.e2e.billing@synthetic.test"
    - navigation "Clean up views":
        - button "Senders 2"
        - button "Triage"
        - button "Screener Plus feature": Screener Plus
    - text: Your inbox, by sender
    - heading "Senders / Make room." [level=1]
    - paragraph: See the pattern. Decide what deserves a place.
    - region "Sender search and filters":
        - combobox "Search senders"
        - button "Mail in Inbox"
        - button "Filter"
        - 'button "Sort: Most received"'
        - text: 2active senders
        - button "Select all 2"
        - paragraph: Active mailbox · Active senders
    - group:
        - list "Senders":
            - listitem:
                - checkbox "Select Fresh Finds Weekly"
                - link "Fresh Finds Weekly":
                    - /url: /senders/e2eb1111-0000-4000-8000-00000000000a
                - text: deals@freshfinds.example 42 emails received · all time
                - button "More actions for Fresh Finds Weekly": ⋯
                - text: 2 in inbox ·0% marked read · 90d
            - listitem:
                - checkbox "Select Meadow Lane Dispatch"
                - link "Meadow Lane Dispatch":
                    - /url: /senders/e2eb1111-0000-4000-8000-00000000000b
                - img "Protected"
                - text: hello@meadowlane.example 7 emails received · all time
                - button "More actions for Meadow Lane Dispatch": ⋯
                - text: 1 in inbox ·0% marked read · 90d
- status
- alert
- region "Cookie consent":
    - button "Close and continue with essential cookies only": ×
    - paragraph: We use essential cookies for sign-in and billing.
    - paragraph: Help us improve DeclutrMail? We use PostHog to understand which features matter. PostHog receives product-usage events, never Gmail message data.
    - button "Accept all"
    - button "Essential only"
```

# Test source

```ts
  55  |   const sidebar = page.getByRole('navigation', { name: 'Product navigation' });
  56  |   if (isMobile) {
  57  |     await expect(tabBar.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  58  |     await expect(sidebar).toHaveCount(0);
  59  |   } else {
  60  |     await expect(tabBar).toHaveCount(0);
  61  |     await expect(sidebar.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  62  |   }
  63  |
  64  |   // The hamburger is present ONLY at phone widths. It needs the same
  65  |   // both-directions assertion, and it has the receipts — an inline `display: inline-flex`
  66  |   // outranked `.dm-topbar-hamburger { display: none }` for 35 days, so the
  67  |   // button rendered on desktop and opened a duplicate sidebar in an
  68  |   // aria-modal dialog over the real one. The jsdom unit test could not see
  69  |   // it (tokens.css never loads there); only a real browser at a real
  70  |   // viewport can, which is why the pin belongs here.
  71  |   const drawerOpener = page.getByRole('button', { name: 'Open navigation menu' });
  72  |   if (isMobile) {
  73  |     await expect(drawerOpener).toHaveAccessibleName('Open navigation menu');
  74  |   } else {
  75  |     await expect(
  76  |       drawerOpener,
  77  |       'hamburger must not render above the 900px breakpoint — the desktop sidebar is already visible',
  78  |     ).toHaveCount(0);
  79  |   }
  80  |   await expect(
  81  |     page.getByRole('button', { name: 'chintan.e2e.billing@synthetic.test', exact: true }),
  82  |   ).toHaveAccessibleName('chintan.e2e.billing@synthetic.test');
  83  | }
  84  |
  85  | test.beforeEach(async ({ page }, testInfo) => {
  86  |   if (testInfo.project.name === MOBILE_PROJECT) {
  87  |     await page.emulateMedia({ reducedMotion: 'reduce' });
  88  |     expect(
  89  |       await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  90  |       'mobile accessibility project must emulate reduced motion',
  91  |     ).toBe(true);
  92  |   }
  93  | });
  94  |
  95  | for (const route of ROUTES) {
  96  |   test(`${route.path} passes the authenticated accessibility smoke`, async ({ page }, testInfo) => {
  97  |     await page.goto(route.path);
  98  |     await expect(page.getByRole('main')).toBeVisible();
  99  |     const ready =
  100 |       route.readyRole === 'help'
  101 |         ? page.getByRole('button', { name: 'About this screen' })
  102 |         : route.readyRole === 'region'
  103 |           ? page.getByRole('region', { name: route.readyName })
  104 |           : page.getByRole('heading', {
  105 |               name: route.readyName,
  106 |               ...(typeof route.readyName === 'string' ? { exact: true } : {}),
  107 |             });
  108 |     await expect(ready).toBeVisible({ timeout: 60_000 });
  109 |
  110 |     await expectCriticalControlsHaveNames(page, testInfo.project.name === MOBILE_PROJECT);
  111 |     await expectNoViewportOverflow(page);
  112 |     await expectNoBlockingAxeViolations(page);
  113 |   });
  114 | }
  115 |
  116 | test('Activity filters load on first open and restore focus', async ({ page }, testInfo) => {
  117 |   await page.goto('/activity');
  118 |   const trigger = page.getByRole('button', { name: /^Filter\b/ });
  119 |   await expect(trigger).toBeVisible({ timeout: 60_000 });
  120 |   const dialog = page.getByRole('dialog', { name: 'Activity filters' });
  121 |   await expect(dialog).toHaveCount(0);
  122 |
  123 |   await trigger.click();
  124 |   await expect(dialog).toBeVisible();
  125 |   await expect(dialog.getByRole('button', { name: 'Manual', exact: true })).toBeVisible();
  126 |   await expectNoViewportOverflow(page);
  127 |   await expectNoBlockingAxeViolations(page);
  128 |
  129 |   if (testInfo.project.name === MOBILE_PROJECT) {
  130 |     await expect(dialog).toHaveAttribute('aria-modal', 'true');
  131 |     await dialog.getByRole('button', { name: 'View results' }).click();
  132 |   } else {
  133 |     await page.keyboard.press('Escape');
  134 |   }
  135 |   await expect(dialog).toHaveCount(0);
  136 |   await expect(trigger).toBeFocused();
  137 | });
  138 |
  139 | test('keyboard shortcut dialog traps and restores focus', async ({ page }) => {
  140 |   await page.goto('/senders');
  141 |   await expect(page.getByRole('heading', { name: /^Senders\b/, level: 1 })).toBeVisible({
  142 |     timeout: 60_000,
  143 |   });
  144 |
  145 |   // The shortcut mechanism under test is global and independent of WHICH
  146 |   // non-input element holds focus; the header's Filter button renders on
  147 |   // every viewport. Never `test.skip()` here: this repo's
  148 |   // `assert-e2e-ran.mjs` CI gate fails loudly on any skip.
  149 |   const trigger = page.getByRole('button', { name: 'Filter', exact: true });
  150 |   await trigger.focus();
  151 |   await expect(trigger).toBeFocused();
  152 |   await page.keyboard.press('?');
  153 |
  154 |   const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
> 155 |   await expect(dialog).toBeVisible();
      |                        ^ Error: expect(locator).toBeVisible() failed
  156 |   const close = dialog.getByRole('button', { name: 'Close shortcuts' });
  157 |   await expect(close).toBeFocused();
  158 |
  159 |   // This dialog has one interactive element. Both directions must cycle
  160 |   // inside it instead of moving focus into the obscured application.
  161 |   await page.keyboard.press('Tab');
  162 |   await expect(close).toBeFocused();
  163 |   await page.keyboard.press('Shift+Tab');
  164 |   await expect(close).toBeFocused();
  165 |
  166 |   await page.keyboard.press('Escape');
  167 |   await expect(dialog).toBeHidden();
  168 |   await expect(trigger).toBeFocused();
  169 | });
  170 |
  171 | // Intercepted export bytes only: no real mailbox data or account/export API write.
  172 | test('Privacy export distinguishes failures, announces preparation and permits a retry', async ({
  173 |   page,
  174 | }) => {
  175 |   await page.goto('/settings/privacy');
  176 |   const section = page.locator('#privacy-export-my-data');
  177 |   const alert = section.getByRole('alert');
  178 |   const status = section.getByRole('status');
  179 |   const pattern = '**/api/account/export?*';
  180 |   await page.route(pattern, (route) => route.fulfill({ status: 500, body: '' }));
  181 |   await section.getByRole('button', { name: 'Download selected data', exact: true }).press('Enter');
  182 |   await expect(alert).toContainText('Try again');
  183 |   await expect(alert).not.toContainText('five minutes');
  184 |   await expect(status).toBeEmpty();
  185 |
  186 |   await page.unroute(pattern);
  187 |   await page.route(pattern, (route) => route.fulfill({ status: 429, body: '' }));
  188 |   await section.getByRole('button', { name: 'Messages CSV', exact: true }).click();
  189 |   await expect(alert).toContainText('five minutes');
  190 |
  191 |   await page.unroute(pattern);
  192 |   await page.route(pattern, (route) => route.abort('failed'));
  193 |   await section.getByRole('button', { name: 'Decisions CSV', exact: true }).click();
  194 |   await expect(alert).toContainText('Try again');
  195 |   await expect(alert).not.toContainText('five minutes');
  196 |
  197 |   await page.unroute(pattern);
  198 |   let release!: () => void;
  199 |   const ready = new Promise<void>((resolve) => {
  200 |     release = resolve;
  201 |   });
  202 |   const contents = 'sender,count\nexample.invalid,1\n';
  203 |   await page.route(pattern, async (route) => {
  204 |     await ready;
  205 |     await route.fulfill({
  206 |       status: 200,
  207 |       headers: {
  208 |         'content-type': 'text/csv',
  209 |         'content-disposition': 'attachment; filename="synthetic-senders.csv"',
  210 |       },
  211 |       body: contents,
  212 |     });
  213 |   });
  214 |   const downloadPromise = page.waitForEvent('download');
  215 |   await section.getByRole('button', { name: 'Senders CSV', exact: true }).press('Enter');
  216 |   for (const button of await section.getByRole('button').all()) await expect(button).toBeDisabled();
  217 |   await expect(alert).toHaveCount(0);
  218 |   await expect(status).toBeEmpty();
  219 |   await expectNoViewportOverflow(page);
  220 |   release();
  221 |   const download = await downloadPromise;
  222 |   // Cross-origin Content-Disposition is not exposed by the API.
  223 |   expect(download.suggestedFilename()).toMatch(/^declutrmail-senders-\d{4}-\d{2}-\d{2}\.csv$/);
  224 |   const path = await download.path();
  225 |   expect(path).not.toBeNull();
  226 |   expect(await readFile(path!, 'utf8')).toBe(contents);
  227 |   await expect(status).toHaveText(
  228 |     "Senders CSV prepared. Check your browser's downloads for the file.",
  229 |   );
  230 |   for (const button of await section.getByRole('button').all()) await expect(button).toBeEnabled();
  231 |   await expectNoBlockingAxeViolations(page);
  232 |   await expectNoViewportOverflow(page);
  233 |
  234 |   await page.reload();
  235 |   await expect(
  236 |     page.getByRole('button', { name: 'Download selected data', exact: true }),
  237 |   ).toBeVisible();
  238 |   await expect(status).toBeEmpty(); // A past handoff is not a durable saved-file receipt.
  239 | });
  240 |
```
