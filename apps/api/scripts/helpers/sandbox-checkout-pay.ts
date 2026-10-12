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
const HOST =
  /^(?:cdn\.paddle\.com|(?:[a-z0-9-]+\.)?paddle\.com|(?:[a-z0-9-]+\.)*spreedly\.com|[a-z0-9-]+\.trycloudflare\.com)$/;

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

/**
 * True only when the visible control holds the sandbox value.
 * Mask spaces and slashes are ignored. The card number is never returned.
 */
export function sandboxTypedValue(
  kind: 'number' | 'expiry' | 'cvc' | 'name',
  actual: string,
): boolean {
  const digits = actual.replace(/\D/g, '');
  switch (kind) {
    case 'number':
      return digits === CARD;
    case 'expiry':
      return digits === EXPIRY;
    case 'cvc':
      return digits === CVC;
    case 'name':
      return actual.trim() === NAME;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Where the card number control lives. No host, url, or frame title. */
export function sandboxFrameToken(depth: unknown): string | null {
  if (depth !== 'overlay' && depth !== 'nested' && depth !== 'absent') return null;
  return `cardFrame:${depth}`;
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
  inputValue(): Promise<string>;
  isDisabled(): Promise<boolean>;
  locator(selector: string): Locator;
  contentFrame(): { locator(selector: string): Locator };
  evaluate(fn: (element: unknown, text: string) => string, text: string): Promise<string>;
  selectOption(value: string | { label: string }): Promise<unknown>;
}

interface Frame {
  locator(selector: string): Locator;
  getByRole(role: 'button' | 'checkbox' | 'textbox', options: { name: RegExp }): Locator;
  title(): Promise<string>;
  url(): string;
  parentFrame(): Frame | null;
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

async function readValue(target: Locator): Promise<string | null> {
  try {
    return await target.inputValue();
  } catch {
    return null;
  }
}

/**
 * Keyboard events from the parent page do not change inputs inside Paddle's
 * overlay frame. Insert each character in that frame so Maskito's beforeinput
 * handler and React's onChange both see it, then read the value back.
 */
export async function commitText(target: Locator, value: string): Promise<string> {
  await target
    .click({ timeout: 2_000 })
    .catch(() => target.click({ force: true, timeout: 2_000 }).catch(() => undefined));
  const written = await target
    .evaluate((element: unknown, text: string) => {
      type Field = {
        nodeName?: string;
        value?: string;
        selectionStart?: number | null;
        selectionEnd?: number | null;
        focus?: () => void;
        setSelectionRange?: (start: number, end: number) => void;
        dispatchEvent?: (event: Event) => boolean;
        querySelector?: (selector: string) => unknown;
        _valueTracker?: { setValue: (next: string) => void };
      };
      const root = element as Field;
      const nested = root.querySelector?.('input,textarea');
      const input = (
        root.nodeName === 'INPUT' || root.nodeName === 'TEXTAREA' ? root : nested
      ) as Field | null;
      if (!input || (input.nodeName !== 'INPUT' && input.nodeName !== 'TEXTAREA')) return '';
      input.focus?.();
      const proto = Object.getPrototypeOf(input) as object;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const write = (next: string, previous: string) => {
        if (setter) setter.call(input, next);
        else input.value = next;
        input._valueTracker?.setValue(previous);
      };
      const fire = (type: string, inputType: string, data: string | null, cancelable: boolean) => {
        const Ctor = (globalThis as { InputEvent?: new (name: string, init: object) => Event })
          .InputEvent;
        const event = Ctor
          ? new Ctor(type, { bubbles: true, cancelable, inputType, data })
          : new Event(type, { bubbles: true, cancelable });
        return input.dispatchEvent?.(event) !== false;
      };
      const current = input.value ?? '';
      if (current) {
        input.setSelectionRange?.(0, current.length);
        fire('beforeinput', 'deleteContentBackward', null, true);
        write('', current);
        fire('input', 'deleteContentBackward', null, false);
      }
      for (const ch of text) {
        const start = input.selectionStart ?? (input.value ?? '').length;
        const end = input.selectionEnd ?? start;
        const previous = input.value ?? '';
        if (!fire('beforeinput', 'insertText', ch, true)) continue;
        write(previous.slice(0, start) + ch + previous.slice(end), previous);
        input.setSelectionRange?.(start + ch.length, start + ch.length);
        fire('input', 'insertText', ch, false);
      }
      input.dispatchEvent?.(new Event('change', { bubbles: true }));
      return input.value ?? '';
    }, value)
    .catch(() => '');
  await new Promise((resolve) => setTimeout(resolve, 50));
  return (await readValue(target)) ?? written;
}

async function typeInto(
  target: Locator,
  value: string,
  accept: (actual: string) => boolean,
): Promise<boolean> {
  const existing = await readValue(target);
  if (existing !== null && accept(existing)) return true;
  try {
    await target.click({ timeout: 2_000 });
    await target.pressSequentially(value, { delay: 25 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const typed = await readValue(target);
    if (typed !== null && accept(typed)) return true;
  } catch {
    /* A nested card frame can ignore keyboard events. */
  }
  return accept(await commitText(target, value));
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
        if (await typeInto(target, value, (actual) => actual.trim() === value)) return true;
      }
    }
  }
  return false;
}

function frameDepth(frame: Frame): number {
  let depth = 0;
  let current = frame.parentFrame();
  while (current && depth < 6) {
    depth += 1;
    current = current.parentFrame();
  }
  return depth;
}

async function nestedCardInput(
  target: Locator,
  selectors: readonly string[],
): Promise<Locator | null> {
  const frames = target.locator('iframe');
  const count = await frames.count().catch(() => 0);
  for (let i = 0; i < count && i < 4; i += 1) {
    const inner = frames.nth(i).contentFrame();
    for (const selector of selectors) {
      const picked = await pick(inner.locator(selector));
      if (picked && (await picked.isVisible().catch(() => false))) return picked;
    }
    const lone = inner.locator('input');
    if ((await lone.count().catch(() => 0)) === 1) {
      const picked = await pick(lone);
      if (picked && (await picked.isVisible().catch(() => false))) return picked;
    }
  }
  return null;
}

async function directInput(target: Locator): Promise<Locator | null> {
  const kind = await target
    .evaluate((element: unknown) => {
      const node = element as { nodeName?: string; querySelector?: (selector: string) => unknown };
      if (node.nodeName === 'INPUT' || node.nodeName === 'TEXTAREA') return 'input';
      if (node.querySelector?.('input,textarea')) return 'wrap';
      return 'other';
    }, '')
    .catch(() => 'other');
  if (kind === 'input') return target;
  if (kind === 'wrap') return pick(target.locator('input, textarea'));
  return null;
}

interface FoundField {
  target: Locator;
  depth: number;
  index: number;
}

/** Deepest visible match wins, so a card iframe under the overlay is preferred. */
async function visibleFields(page: Page, selectors: readonly string[]): Promise<FoundField[]> {
  const found: FoundField[] = [];
  let index = 0;
  for (const frame of page.frames()) {
    const depth = frameDepth(frame);
    for (const selector of selectors) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count && i < 4; i += 1) {
        const target = locator.nth(i);
        if (!(await target.isVisible().catch(() => false))) continue;
        index += 1;
        const nested = await nestedCardInput(target, selectors);
        if (nested) {
          found.push({ target: nested, depth: depth + 1, index });
          continue;
        }
        const input = await directInput(target);
        if (input) found.push({ target: input, depth, index });
      }
    }
  }
  found.sort((left, right) => right.depth - left.depth || right.index - left.index);
  return found;
}

async function fieldHolds(
  page: Page,
  selectors: readonly string[],
  accept: (actual: string) => boolean,
): Promise<boolean> {
  for (const { target } of await visibleFields(page, selectors)) {
    const live = await readValue(target);
    if (live !== null && accept(live)) return true;
  }
  return false;
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
  accept: (actual: string) => boolean,
  done: boolean,
): Promise<boolean> {
  if (done) return true;
  for (const { target } of await visibleFields(page, selectors)) {
    if (await typeInto(target, value, accept)) return true;
  }
  if (role) {
    const labeled = await roleField(page, role);
    if (labeled && (await typeInto(labeled, value, accept))) return true;
  }
  const lone = await loneField(page, loneTitle);
  return lone !== null && (await typeInto(lone, value, accept));
}

async function holdField(
  page: Page,
  selectors: readonly string[],
  loneTitle: RegExp,
  role: RegExp | null,
  value: string,
  kind: 'number' | 'expiry' | 'cvc' | 'name',
): Promise<boolean> {
  const accept = (actual: string) => sandboxTypedValue(kind, actual);
  if (await fieldHolds(page, selectors, accept)) return true;
  await ensureField(page, selectors, loneTitle, role, value, accept, false);
  return fieldHolds(page, selectors, accept);
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
    let payClicked = false;
    let sawOverlay = false;
    let cardFrame: 'absent' | 'overlay' | 'nested' = 'absent';
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
      const numberFields = await visibleFields(page, SANDBOX_CARD_SELECTORS);
      if (numberFields[0]) cardFrame = numberFields[0].depth >= 2 ? 'nested' : 'overlay';
      if (!numberFields.length && Date.now() - lastClick > 8_000) {
        const seen = await probeFields(page);
        if (seen.includes('cardNumberInput:absent')) {
          await chooseCard(page);
          lastClick = Date.now();
        }
      }
      const nameOk = await holdField(
        page,
        NAME_SELECTORS,
        /card holder|name on card/,
        /card holder|name on card/i,
        NAME,
        'name',
      );
      const numberOk = await holdField(
        page,
        SANDBOX_CARD_SELECTORS,
        /card number|^number$/,
        /^card number$/i,
        CARD,
        'number',
      );
      const expiryOk = await holdField(
        page,
        EXPIRY_SELECTORS,
        /expir|^mm/,
        /^expiry$/i,
        EXPIRY,
        'expiry',
      );
      const cvcOk = await holdField(
        page,
        CVC_SELECTORS,
        /cvc|cvv|security|card code/,
        /^cvv$/i,
        CVC,
        'cvc',
      );
      const ready = numberOk && expiryOk && cvcOk && nameOk;
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
    const held = {
      cardNumberInput: await fieldHolds(page, SANDBOX_CARD_SELECTORS, (actual) =>
        sandboxTypedValue('number', actual),
      ),
      expiryDateField: await fieldHolds(page, EXPIRY_SELECTORS, (actual) =>
        sandboxTypedValue('expiry', actual),
      ),
      cardVerificationValueInput: await fieldHolds(page, CVC_SELECTORS, (actual) =>
        sandboxTypedValue('cvc', actual),
      ),
      cardholderNameInput: await fieldHolds(page, NAME_SELECTORS, (actual) =>
        sandboxTypedValue('name', actual),
      ),
    };
    const frameToken = sandboxFrameToken(cardFrame);
    return {
      frames: await frameTitles(page),
      hosts,
      overlay: overlayPresent(hosts) ? 'present' : 'absent',
      card:
        held.cardNumberInput &&
        held.expiryDateField &&
        held.cardVerificationValueInput &&
        held.cardholderNameInput
          ? 'filled'
          : 'missing',
      pay: payClicked ? 'clicked' : 'missing',
      events: await readEvents(page),
      consoleLines,
      shots,
      fields: [...notedFields(await probeFields(page), held), ...(frameToken ? [frameToken] : [])],
    };
  } finally {
    await browser.close();
  }
}
