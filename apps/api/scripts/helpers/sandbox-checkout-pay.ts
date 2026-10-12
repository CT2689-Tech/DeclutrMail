/**
 * Submit a Paddle sandbox hosted checkout with the no-3DS test card.
 * The caller decides success from the transaction read, not from page copy.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CARD = '4242424242424242';
const EXPIRY = '1230';
const CVC = '100';
const NAME = 'Synthetic Fixture';

export interface CheckoutPayFailure {
  frames: string[];
  overlay: 'present' | 'absent';
  card: 'filled' | 'missing';
  pay: 'clicked' | 'missing';
}

/** Names Paddle's card iframes use. A page without these never completes a sandbox payment. */
export const SANDBOX_CARD_SELECTORS = [
  'input[name="cardNumber"]',
  'input[name="cardnumber"]',
  'input[autocomplete="cc-number"]',
  'input[aria-label*="Card number" i]',
  'input[placeholder*="1234" i]',
] as const;

interface Locator {
  count(): Promise<number>;
  first(): Locator;
  fill(value: string): Promise<void>;
  isVisible(): Promise<boolean>;
  click(): Promise<void>;
  pressSequentially(value: string, options?: { delay?: number }): Promise<void>;
  selectOption(value: string | { label: string }): Promise<unknown>;
}

interface Frame {
  locator(selector: string): Locator;
  getByRole(role: 'button', options: { name: RegExp }): Locator;
  title(): Promise<string>;
  url(): string;
}

interface Page {
  frames(): Frame[];
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
}

interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

function playwright(): { chromium: { launch(options: { headless: boolean }): Promise<Browser> } } {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const require = createRequire(resolve(here, '../../../../packages/e2e/package.json'));
  return require('@playwright/test') as {
    chromium: { launch(options: { headless: boolean }): Promise<Browser> };
  };
}

async function visible(locator: Locator): Promise<Locator | null> {
  if ((await locator.count().catch(() => 0)) < 1) return null;
  const target = locator.first();
  if (!(await target.isVisible().catch(() => false))) return null;
  return target;
}

async function typeInto(target: Locator, value: string): Promise<boolean> {
  try {
    await target.fill(value);
    return true;
  } catch {
    try {
      await target.click();
      await target.pressSequentially(value, { delay: 20 });
      return true;
    } catch {
      return false;
    }
  }
}

async function fillAny(page: Page, selectors: readonly string[], value: string): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const target = await visible(frame.locator(selector));
      if (!target) continue;
      if (await typeInto(target, value)) return true;
    }
  }
  return false;
}

async function clickAny(page: Page, name: RegExp): Promise<boolean> {
  for (const frame of page.frames()) {
    const target = await visible(frame.getByRole('button', { name }));
    if (!target) continue;
    try {
      await target.click();
    } catch {
      continue;
    }
    return true;
  }
  return false;
}

async function chooseCountry(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const target = await visible(
      frame.locator('select[name*="country" i], select[autocomplete="country"], select'),
    );
    if (!target) continue;
    try {
      await target.selectOption('US');
    } catch {
      await target.selectOption({ label: 'United States' }).catch(() => undefined);
    }
    return;
  }
}

async function fillLoneCardFrames(page: Page): Promise<boolean> {
  const singles: { title: string; target: Locator }[] = [];
  for (const frame of page.frames()) {
    const inputs = frame.locator('input');
    if ((await inputs.count().catch(() => 0)) !== 1) continue;
    const target = await visible(inputs);
    if (!target) continue;
    singles.push({ title: (await frame.title().catch(() => '')).toLowerCase(), target });
  }
  const pick = (pattern: RegExp, fallback: number) =>
    singles.find((row) => pattern.test(row.title)) ?? singles[fallback];
  const number = pick(/card number|^number$/, 0);
  const expiry = pick(/expir|^mm/, 1);
  const cvc = pick(/cvc|cvv|security|card code/, 2);
  if (!number || !expiry || !cvc || new Set([number, expiry, cvc]).size < 3) return false;
  return (
    (await typeInto(number.target, CARD)) &&
    (await typeInto(expiry.target, EXPIRY)) &&
    (await typeInto(cvc.target, CVC))
  );
}

async function frameTitles(page: Page): Promise<string[]> {
  const titles: string[] = [];
  for (const frame of page.frames()) {
    const title = await frame.title().catch(() => '');
    if (/^[A-Za-z][A-Za-z ]{0,40}$/.test(title)) titles.push(title);
  }
  return titles.slice(0, 12);
}

function overlayPresent(page: Page): boolean {
  for (const frame of page.frames()) {
    let raw = '';
    try {
      raw = frame.url();
      const host = new URL(raw).hostname;
      if (host === 'cdn.paddle.com' || host.endsWith('.paddle.com')) return true;
    } catch {
      /* about:blank and empty frames are not the overlay. */
    }
  }
  return false;
}

/**
 * Keeps the hosted checkout open until `paid` is true.
 * Returns null when the provider transaction is paid. Frames are safe titles only.
 */
export async function paySandboxCheckout(
  checkoutUrl: string,
  email: string,
  paid: () => Promise<boolean>,
): Promise<CheckoutPayFailure | null> {
  const miss = (overlay: CheckoutPayFailure['overlay']): CheckoutPayFailure => ({
    frames: [],
    overlay,
    card: 'missing',
    pay: 'missing',
  });
  if (!checkoutUrl.startsWith('https://') || !email.endsWith('@example.test'))
    return miss('absent');
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const deadline = Date.now() + 180_000;
    let lastClick = 0;
    let cardFilled = false;
    let payClicked = false;
    while (Date.now() < deadline) {
      if (await paid().catch(() => false)) return null;
      await fillAny(
        page,
        ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]'],
        email,
      );
      await chooseCountry(page);
      await fillAny(
        page,
        [
          'input[name="postal_code"]',
          'input[name="postcode"]',
          'input[autocomplete="postal-code"]',
          'input[aria-label*="ZIP" i]',
          'input[aria-label*="Postal" i]',
        ],
        '10001',
      );
      const labeled = await fillAny(page, SANDBOX_CARD_SELECTORS, CARD);
      const card = labeled || (await fillLoneCardFrames(page));
      if (card) cardFilled = true;
      const due = Date.now() - lastClick > 8_000;
      if (card && due) {
        if (labeled) {
          await fillAny(
            page,
            [
              'input[name="expiry"]',
              'input[name="exp-date"]',
              'input[autocomplete="cc-exp"]',
              'input[aria-label*="Expir" i]',
              'input[placeholder*="MM" i]',
            ],
            EXPIRY,
          );
          await fillAny(
            page,
            [
              'input[name="cvv"]',
              'input[name="cvc"]',
              'input[autocomplete="cc-csc"]',
              'input[aria-label*="CVC" i]',
              'input[aria-label*="CVV" i]',
            ],
            CVC,
          );
        }
        await fillAny(
          page,
          [
            'input[name="cardholderName"]',
            'input[autocomplete="cc-name"]',
            'input[aria-label*="Name on card" i]',
          ],
          NAME,
        );
        if (await clickAny(page, /pay now|subscribe|buy now|confirm|pay/i)) {
          payClicked = true;
          lastClick = Date.now();
        }
      } else if (!card && due && (await clickAny(page, /continue|next/i))) {
        lastClick = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return {
      frames: await frameTitles(page),
      overlay: overlayPresent(page) ? 'present' : 'absent',
      card: cardFilled ? 'filled' : 'missing',
      pay: payClicked ? 'clicked' : 'missing',
    };
  } finally {
    await browser.close();
  }
}
