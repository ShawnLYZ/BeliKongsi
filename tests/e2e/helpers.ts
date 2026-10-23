import { expect, type Locator, type Page } from '@playwright/test';

export type DemoAction = 'Reset demo data' | 'Skip to cut-off' | 'Complete other rounds';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The top bar's business and role switcher button (its name ends "switch business or role"). */
function switcher(page: Page): Locator {
  return page.getByRole('button', { name: /switch business or role/ });
}

/** Becomes another seeded account through the demo account list, and waits for its home page. */
export async function switchTo(page: Page, displayName: string): Promise<void> {
  await switcher(page).click();
  const dialog = page.getByRole('dialog', { name: 'Switch business or role' });
  await dialog.getByRole('button', { name: new RegExp(`^${escape(displayName)}\\b`) }).click();
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toContainText(displayName);
}

const CONFIRM: Partial<Record<DemoAction, string>> = {
  'Skip to cut-off': 'Yes, skip to cut-off',
  'Complete other rounds': 'Yes, complete other rounds',
};

const DONE: Record<DemoAction, RegExp> = {
  'Reset demo data': /Demo data reset\./,
  'Skip to cut-off': /Skipped to .* closed\./,
  'Complete other rounds': /other rounds? completed\./,
};

/** Runs one of the demo controls (confirming it where the menu asks) and waits for its toast. */
export async function demo(page: Page, action: DemoAction): Promise<void> {
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Demo controls' });
  await dialog.getByRole('button', { name: action, exact: true }).click();
  const confirm = CONFIRM[action];
  if (confirm) await dialog.getByRole('button', { name: confirm }).click();
  await expect(page.getByText(DONE[action])).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toBeHidden();
}

/** Expects an amount such as "RM 984.54" to be visible in the page or the given part of it. */
export async function expectMoney(scope: Page | Locator, text: string): Promise<void> {
  await expect(scope.getByText(text).first()).toBeVisible();
}

/** Signs in with the simulated Microsoft sign-in as the named seeded account and waits for its home. */
export async function signInAs(page: Page, displayName: string, home = /\/owner$/): Promise<void> {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /Continue with Microsoft/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${escape(displayName)}\\b`) }).click();
  await expect(page).toHaveURL(home);
}

/**
 * Resets the demo data, then plays the PRD §23 demo up to the cut-off with Ah Seng signed in
 * (the same steps as demo.spec.ts), which leaves RM 73.44 of refunds in his BeliKongsi balance.
 */
export async function giveAhSengABalance(page: Page): Promise<void> {
  await demo(page, 'Reset demo data');

  await page.getByRole('link', { name: 'Finish setup' }).click();
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await page.getByRole('button', { name: 'Read my order' }).click();
  const list = page.getByRole('list', { name: 'Your usual list' });
  await expect(list).toBeVisible({ timeout: 60_000 });
  const eggs = list.getByRole('listitem').filter({ hasText: 'telur 10 papan' });
  if (await eggs.getByText('Please check', { exact: true }).isVisible()) {
    await eggs.getByRole('radio', { name: /Grade A eggs/ }).check();
  }
  await page.getByRole('button', { name: /^Confirm my usual list/ }).click();
  await page.getByRole('radio', { name: /^Ipoh pickup point/ }).check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 3 of 3: Done')).toBeVisible();

  await switchTo(page, 'Rahim');
  await page.getByRole('link', { name: 'Add to next basket' }).click();
  await page.getByLabel('What does the shop need?').fill('evaporated');
  await page
    .getByRole('list', { name: 'Matching products' })
    .getByRole('button', { name: /^Evaporated milk/ })
    .click();
  await page.getByRole('button', { name: 'Add to next basket' }).click();
  await expect(
    page
      .getByRole('region', { name: 'My recent additions' })
      .getByRole('listitem')
      .filter({ hasText: 'Evaporated milk' }),
  ).toContainText("Waiting for owner's approval");

  await switchTo(page, 'Ah Seng');
  await page.getByRole('link', { name: "This week's basket" }).first().click();
  await page.getByRole('button', { name: 'Approve & pay' }).click();
  await page.getByRole('tab', { name: 'DuitNow QR' }).click();
  await page.getByRole('button', { name: 'Pay (simulated)' }).click();
  await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();

  await demo(page, 'Skip to cut-off');
  await page.goto('/owner/money');
  await expect(page.getByText('+RM 73.44 to your balance').first()).toBeVisible();
}

/** "RM 1,234.56" as 123456 sen. */
export function senOf(text: string): number {
  const m = /RM\s*([\d,]+)\.(\d{2})/.exec(text);
  if (!m) throw new Error(`No amount in "${text}"`);
  return Number(m[1]!.replace(/,/g, '')) * 100 + Number(m[2]);
}

/** 6338 as "RM 63.38". */
export function rm(sen: number): string {
  const whole = Math.floor(sen / 100).toLocaleString('en');
  return `RM ${whole}.${String(sen % 100).padStart(2, '0')}`;
}

/** The balance shown at the top of the Money screen, in sen. */
export async function readBalanceSen(page: Page): Promise<number> {
  const box = page.getByRole('heading', { name: 'Your BeliKongsi balance' }).locator('..');
  return senOf(await box.locator('p').first().innerText());
}
