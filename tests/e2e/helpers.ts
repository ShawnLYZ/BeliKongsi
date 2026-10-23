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
