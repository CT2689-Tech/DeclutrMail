/**
 * Submit a Paddle sandbox overlay checkout with the no-3DS test card.
 * The caller decides success from the transaction read, not from page copy.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CARD = '4242424242424242';
const EXPIRY = '1230';
const CVC = '100';
const NAME = 'Synthetic Fixture';
const CHECKOUT_EVENT = /^checkout\.[a-z.]{1,60}(?::[a-z0-9_]{1,64})?$/;
const SAFE_LINE = /^[A-Za-z][A-Za-z ,'-]{0,159}$/;
const SHOT_NAME = /^[a-z]+(?:-[a-z]+)*-[0-9]{2}-[a-z]+\.png$/;
const HOST = /^(?:cdn\.paddle\.com|(?:[a-z0-9-]+\.)?paddle\.com|[a-z0-9-]+\.trycloudflare\.com)$/;

export interface CheckoutPayFailure {
  frames: string[];
  hosts: string[];
  overlay: 'present' | 'absent';
  card: 'filled' | 'missing';
  pay: 'clicked' | 'missing';
  events: string[];
  consoleLines: string[];
  shots: string[];
  fields: string[];
}

export interface CheckoutPayOptions {
  shotsDir?: string;
  label?: string;
}

/**
 * One-page Paddle checkout inputs. The visible card box is
 * `[data-testid="cardNumberInput"]` with placeholder `xxxx`, not a lone PCI iframe.
 */
export const SANDBOX_CARD_SELECTORS = [
  '[data-testid="cardNumberInput"]',
  'input[name="cardNumber"]',
  'input[name="cardnumber"]',
  'input[autocomplete="cc-number"]',
  'input[aria-label="Card number" i]',
  'input[placeholder*="xxxx" i]',
  'input[placeholder*="1234" i]',
] as const;

const EXPIRY_SELECTORS = [
  '[data-testid="expiryDateField"]',
  'input[name="expiry"]',
  'input[name="exp-date"]',
  'input[autocomplete="cc-exp"]',
  'input[aria-label="Expiry" i]',
  'input[placeholder*="MM" i]',
] as const;

const CVC_SELECTORS = [
  '[data-testid="cardVerificationValueInput"]',
  'input[name="cvv"]',
  'input[name="cvc"]',
  'input[autocomplete="cc-csc"]',
  'input[aria-label="CVV" i]',
  'input[aria-label*="CVC" i]',
] as const;

const NAME_SELECTORS = [
  '[data-testid="cardholderNameInput"]',
  'input[name="cardHolder"]',
  'input[name="cardholderName"]',
  'input[autocomplete="cc-name"]',
  'input[aria-label="Card holder" i]',
  'input[aria-label*="Name on card" i]',
] as const;

/** Ids from the sandbox checkout bundle. Anything else is dropped. */
export const SANDBOX_FIELD_IDS = [
  'cardNumberInput',
  'expiryDateField',
  'cardVerificationValueInput',
  'cardholderNameInput',
  'cardPaymentFormSubmitButton',
] as const;

const FIELD_STATE = /^(absent|hidden|shown|typed|disabled)$/;

/** Allowlisted checkout control plus a state word. No page text. */
export function sandboxFieldToken(id: unknown, state: unknown): string | null {
  if (typeof id !== 'string' || !(SANDBOX_FIELD_IDS as readonly string[]).includes(id)) return null;
  if (typeof state !== 'string' || !FIELD_STATE.test(state)) return null;
  return `${id}:${state}`;
}

/** Card submit only. A wallet button such as PayPal matches "pay" and does not charge the card. */
export function isCardPayButton(name: string): boolean {
  const label = name.replace(/\s+/g, ' ').trim();
  if (/paypal|apple pay|google pay|venmo|\blink\b/i.test(label)) return false;
  return /^(pay|subscribe|buy now)\b/i.test(label);
}

/** Paddle.js event name plus an optional error code. Anything else is dropped. */
export function sandboxCheckoutEvent(name: unknown, code: unknown): string | null {
  if (typeof name !== 'string' || !/^checkout\.[a-z.]{1,60}$/.test(name)) return null;
  if (code === undefined || code === null || code === '') return name;
  if (typeof code !== 'string' || !/^[a-z0-9_]{1,64}$/.test(code)) return null;
  return `${name}:${code}`;
}

interface Locator {
  count(): Promise<number>;
  first(): Locator;
  nth(index: number): Locator;
  fill(value: string): Promise<void>;
  isVisible(): Promise<boolean>;
  isChecked(): Promise<boolean>;
  check(): Promise<void>;
  click(options?: { force?: boolean; timeout?: number }): Promise<void>;
  focus(options?: { timeout?: number }): Promise<void>;
  press(key: string): Promise<void>;
  pressSequentially(value: string, options?: { delay?: number }): Promise<void>;
  innerText(): Promise<string>;
  isDisabled(): Promise<boolean>;
  selectOption(value: string | { label: string }): Promise<unknown>;
}

interface Frame {
  locator(selector: string): Locator;
  getByRole(role: 'button' | 'checkbox' | 'textbox', options: { name: RegExp }): Locator;
  title(): Promise<string>;
  url(): string;
}

interface ConsoleMessage {
  text(): string;
}

interface Page {
  frames(): Frame[];
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  on(event: 'console', handler: (message: ConsoleMessage) => void): void;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  evaluate(fn: () => unknown): Promise<unknown>;
  screenshot(options: { path: string }): Promise<unknown>;
  setDefaultTimeout(timeout: number): void;
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

/** A hidden first match must not hide the visible one-page input behind it. */
async function pick(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);
  let hidden: Locator | null = null;
  for (let i = 0; i < count && i < 6; i += 1) {
    const target = locator.nth(i);
    if (await target.isVisible().catch(() => false)) return target;
    hidden ??= target;
  }
  return hidden;
}

async function typeInto(target: Locator, value: string): Promise<boolean> {
  try {
    await target.click({ force: true, timeout: 2_000 });
    await target.press('Control+a');
    await target.pressSequentially(value, { delay: 25 });
    await target.press('Tab').catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function fillAny(page: Page, selectors: readonly string[], value: string): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const target = await pick(frame.locator(selector));
      if (!target) continue;
      try {
        await target.fill(value);
        return true;
      } catch {
        if (await typeInto(target, value)) return true;
      }
    }
  }
  return false;
}

async function findField(page: Page, selectors: readonly string[]): Promise<Locator | null> {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const target = await pick(frame.locator(selector));
      if (target) return target;
    }
  }
  return null;
}

async function loneField(page: Page, pattern: RegExp): Promise<Locator | null> {
  for (const frame of page.frames()) {
    const inputs = frame.locator('input');
    if ((await inputs.count().catch(() => 0)) !== 1) continue;
    const title = (await frame.title().catch(() => '')).toLowerCase();
    if (!pattern.test(title)) continue;
    const target = await pick(inputs);
    if (target) return target;
  }
  return null;
}

async function roleField(page: Page, name: RegExp): Promise<Locator | null> {
  for (const frame of page.frames()) {
    const target = await pick(frame.getByRole('textbox', { name }));
    if (target) return target;
  }
  return null;
}

async function ensureField(
  page: Page,
  selectors: readonly string[],
  loneTitle: RegExp,
  role: RegExp | null,
  value: string,
  done: boolean,
): Promise<boolean> {
  if (done) return true;
  const labeled = (await findField(page, selectors)) ?? (role ? await roleField(page, role) : null);
  if (labeled && (await typeInto(labeled, value))) return true;
  const lone = await loneField(page, loneTitle);
  return lone !== null && (await typeInto(lone, value));
}

async function clickCardPay(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const marked = frame.locator('[data-testid="cardPaymentFormSubmitButton"]');
    const roles = frame.getByRole('button', { name: /^(pay|subscribe|buy now)\b/i });
    for (const buttons of [marked, roles]) {
      const count = await buttons.count().catch(() => 0);
      for (let i = 0; i < count && i < 8; i += 1) {
        const target = buttons.nth(i);
        if (await target.isDisabled().catch(() => true)) continue;
        const label = await target.innerText().catch(() => '');
        if (label && !isCardPayButton(label)) continue;
        if (!(await target.isVisible().catch(() => false))) continue;
        try {
          await target.click({ timeout: 2_000 });
          return true;
        } catch {
          continue;
        }
      }
    }
  }
  return false;
}

async function clickAny(page: Page, name: RegExp): Promise<boolean> {
  for (const frame of page.frames()) {
    const target = await pick(frame.getByRole('button', { name }));
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

async function acceptTerms(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const boxes = frame.getByRole('checkbox', { name: /terms|agree/i });
    const count = await boxes.count().catch(() => 0);
    for (let i = 0; i < count && i < 3; i += 1) {
      const box = boxes.nth(i);
      if (await box.isChecked().catch(() => true)) continue;
      await box.check().catch(() => undefined);
    }
  }
}

async function chooseCountry(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const target = await pick(
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

async function frameTitles(page: Page): Promise<string[]> {
  const titles: string[] = [];
  for (const frame of page.frames()) {
    const title = await frame.title().catch(() => '');
    if (/^[A-Za-z][A-Za-z ]{0,40}$/.test(title)) titles.push(title);
  }
  return titles.slice(0, 12);
}

function frameHosts(page: Page): string[] {
  const hosts: string[] = [];
  for (const frame of page.frames()) {
    try {
      const host = new URL(frame.url()).hostname;
      if (HOST.test(host) && !hosts.includes(host)) hosts.push(host);
    } catch {
      /* about:blank is not a checkout host. */
    }
  }
  return hosts.slice(0, 8);
}

function overlayPresent(hosts: string[]): boolean {
  return hosts.some((host) => host === 'cdn.paddle.com' || host.endsWith('.paddle.com'));
}

async function readEvents(page: Page): Promise<string[]> {
  const raw = await page
    .evaluate(() => {
      const value = (globalThis as { __paddleEvents?: unknown }).__paddleEvents;
      return Array.isArray(value) ? value.slice(-20) : [];
    })
    .catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((line): line is string => typeof line === 'string' && CHECKOUT_EVENT.test(line))
    .slice(-12);
}

function shotsRoot(dir: string | undefined): string | undefined {
  const root = process.env.RUNNER_TEMP;
  if (!dir || !root || !dir.startsWith(`${root}/`)) return undefined;
  return dir;
}

async function shot(
  page: Page,
  dir: string | undefined,
  name: string,
  taken: string[],
): Promise<void> {
  if (!dir || !SHOT_NAME.test(name) || taken.includes(name)) return;
  try {
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: join(dir, name) });
    taken.push(name);
  } catch {
    /* A missing picture must not hide the payment result. */
  }
}

async function probeFields(page: Page): Promise<string[]> {
  const tokens: string[] = [];
  for (const id of SANDBOX_FIELD_IDS) {
    let state: 'absent' | 'hidden' | 'shown' | 'disabled' = 'absent';
    const rank = { absent: 0, hidden: 1, disabled: 2, shown: 3 };
    for (const frame of page.frames()) {
      const locator = frame.locator(`[data-testid="${id}"]`);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count && i < 4; i += 1) {
        const target = locator.nth(i);
        const shown = await target.isVisible().catch(() => false);
        const disabled = shown && (await target.isDisabled().catch(() => false));
        let next: 'hidden' | 'disabled' | 'shown' = 'shown';
        if (!shown) next = 'hidden';
        else if (disabled) next = 'disabled';
        if (rank[next] > rank[state]) state = next;
      }
    }
    const token = sandboxFieldToken(id, state);
    if (token) tokens.push(token);
  }
  return tokens;
}

function notedFields(tokens: string[], typed: Record<string, boolean>): string[] {
  let next = tokens;
  for (const [id, done] of Object.entries(typed)) {
    if (!done) continue;
    const token = sandboxFieldToken(id, 'typed');
    if (!token) continue;
    next = [...next.filter((line) => !line.startsWith(`${id}:`)), token];
  }
  return next;
}

async function chooseCard(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const target = await pick(frame.getByRole('button', { name: /^card$/i }));
    if (!target || (await target.isDisabled().catch(() => true))) continue;
    await target.click({ timeout: 2_000 }).catch(() => undefined);
    return;
  }
}

function blank(overlay: CheckoutPayFailure['overlay']): CheckoutPayFailure {
  return {
    frames: [],
    hosts: [],
    overlay,
    card: 'missing',
    pay: 'missing',
    events: [],
    consoleLines: [],
    shots: [],
    fields: [],
  };
}

/**
 * Keeps the overlay checkout open until `paid` is true.
 * Returns null when the provider transaction is paid.
 */
export async function paySandboxCheckout(
  checkoutUrl: string,
  email: string,
  paid: () => Promise<boolean>,
  options: CheckoutPayOptions = {},
): Promise<CheckoutPayFailure | null> {
  if (!checkoutUrl.startsWith('https://') || !email.endsWith('@example.test'))
    return blank('absent');
  const pictures = shotsRoot(options.shotsDir);
  const label = /^[a-z]+(?:-[a-z]+){0,3}$/.test(options.label ?? '') ? options.label! : 'checkout';
  const browser = await playwright().chromium.launch({ headless: true });
  const consoleLines: string[] = [];
  const shots: string[] = [];
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      const text = message.text();
      if (SAFE_LINE.test(text) && consoleLines.length < 12) consoleLines.push(text);
    });
    page.on('pageerror', (error) => {
      const text = error.message.split('\n')[0] ?? '';
      if (SAFE_LINE.test(text) && consoleLines.length < 12) consoleLines.push(text);
    });
    page.setDefaultTimeout(5_000);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await shot(page, pictures, `${label}-01-page.png`, shots);
    const deadline = Date.now() + 180_000;
    let lastClick = 0;
    const fields = { number: false, expiry: false, cvc: false, name: false };
    let payClicked = false;
    let sawOverlay = false;
    while (Date.now() < deadline) {
      if (await paid().catch(() => false)) return null;
      const hosts = frameHosts(page);
      if (!sawOverlay && overlayPresent(hosts)) {
        sawOverlay = true;
        await shot(page, pictures, `${label}-02-overlay.png`, shots);
      }
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
      if (!fields.number && Date.now() - lastClick > 8_000) {
        const seen = await probeFields(page);
        if (seen.includes('cardNumberInput:absent')) {
          await chooseCard(page);
          lastClick = Date.now();
        }
      }
      fields.name = await ensureField(
        page,
        NAME_SELECTORS,
        /card holder|name on card/,
        /card holder|name on card/i,
        NAME,
        fields.name,
      );
      fields.number = await ensureField(
        page,
        SANDBOX_CARD_SELECTORS,
        /card number|^number$/,
        /^card number$/i,
        CARD,
        fields.number,
      );
      fields.expiry = await ensureField(
        page,
        EXPIRY_SELECTORS,
        /expir|^mm/,
        /^expiry$/i,
        EXPIRY,
        fields.expiry,
      );
      fields.cvc = await ensureField(
        page,
        CVC_SELECTORS,
        /cvc|cvv|security|card code/,
        /^cvv$/i,
        CVC,
        fields.cvc,
      );
      const ready = fields.number && fields.expiry && fields.cvc && fields.name;
      if (ready) await shot(page, pictures, `${label}-03-card.png`, shots);
      const due = Date.now() - lastClick > 8_000;
      if (ready && due) {
        await acceptTerms(page);
        if (await clickCardPay(page)) {
          payClicked = true;
          lastClick = Date.now();
          await shot(page, pictures, `${label}-04-pay.png`, shots);
        }
      } else if (!ready && due && (await clickAny(page, /continue|next/i))) {
        lastClick = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await shot(page, pictures, `${label}-05-timeout.png`, shots);
    const hosts = frameHosts(page);
    return {
      frames: await frameTitles(page),
      hosts,
      overlay: overlayPresent(hosts) ? 'present' : 'absent',
      card: fields.number && fields.expiry && fields.cvc && fields.name ? 'filled' : 'missing',
      pay: payClicked ? 'clicked' : 'missing',
      events: await readEvents(page),
      consoleLines,
      shots,
      fields: notedFields(await probeFields(page), {
        cardNumberInput: fields.number,
        expiryDateField: fields.expiry,
        cardVerificationValueInput: fields.cvc,
        cardholderNameInput: fields.name,
      }),
    };
  } finally {
    await browser.close();
  }
}
