import { expect, test, type Page } from '@playwright/test';
import {
  demo,
  expectMoney,
  giveAhSengABalance,
  readBalanceSen,
  rm,
  signInAs,
  switchTo,
} from './helpers';

/** No sideways scroll at phone width (G9). */
async function expectNoOverflow(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

/** Each test starts from freshly reset demo data, signed in as Ah Seng (owner of Kedai Kopi Contoh). */
async function startAsAhSeng(page: Page): Promise<void> {
  await signInAs(page, 'Ah Seng');
  await demo(page, 'Reset demo data');
}

const SHOP_ID = /\/api\/shops\/([0-9a-f-]{36})\//;

test.describe('owner screens at phone size', () => {
  test('auto-approve asks for the AutoDebit consent, then switches on and off', async ({
    page,
  }) => {
    await startAsAhSeng(page);
    await page.goto('/owner/settings');
    const sw = page.getByRole('switch', { name: /Auto-approve is/ });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByText("Only if every item's starting all-in price is below my usual price"),
    ).toBeVisible();
    await page.getByLabel('Only if the basket is no more than').fill('400');
    await sw.click();

    const dialog = page.getByRole('dialog', { name: 'DuitNow AutoDebit — Simulated' });
    await expect(dialog).toContainText('only a mandate reference');
    await expect(dialog).toContainText('switch the rule off any time');
    await expectNoOverflow(page);
    const agree = dialog.getByRole('button', { name: 'Agree and switch on' });
    await expect(agree).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await agree.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/SIM-MANDATE-/)).toBeVisible();
    await expect(page.getByLabel('Only if the basket is no more than')).toHaveValue('400.00');
    await expectNoOverflow(page);

    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  test('saving the minutes keeps the fulfilment just chosen', async ({ page }) => {
    await startAsAhSeng(page);
    await page.goto('/owner/settings');

    // Choose and save a pickup point, then save the minutes without reloading the page.
    const picked = page.locator('input[name="fulfilment"][value^="pickup:"]').first();
    await picked.check();
    const pickedValue = (await picked.getAttribute('value'))!.replace('pickup:', '');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.').first()).toBeVisible();

    // Change to a different pickup point and save it, with the minutes form still showing old props.
    const other = page.locator('input[name="fulfilment"][value^="pickup:"]').nth(1);
    await other.check();
    const otherValue = (await other.getAttribute('value'))!.replace('pickup:', '');
    expect(otherValue).not.toBe(pickedValue);
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Saved.').first()).toBeVisible();

    await page
      .getByLabel('How many minutes a week did ordering take you before BeliKongsi?')
      .fill('90');
    await page
      .getByRole('region', { name: 'Time saved' })
      .getByRole('button', { name: 'Save' })
      .click();
    const settingsUrl = (await page
      .getByRole('link', { name: 'Export my data' })
      .getAttribute('href'))!.replace('/export', '/settings');
    await expect
      .poll(async () => (await (await page.request.get(settingsUrl)).json()).oldMinutesPerWeek)
      .toBe(90);
    const settings = await (await page.request.get(settingsUrl)).json();
    expect(settings.defaultFulfilment).toBe('pickup');
    expect(settings.pickupPoint.id).toBe(otherValue);
    expect(settings.oldMinutesPerWeek).toBe(90);
    await expectNoOverflow(page);
  });

  test('the export is a ZIP download', async ({ page }) => {
    await startAsAhSeng(page);
    await page.goto('/owner/settings');
    const link = page.getByRole('link', { name: 'Export my data' });
    await expect(link).toHaveAttribute('href', SHOP_ID);
    const res = await page.request.get((await link.getAttribute('href'))!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/zip');
    expect(res.headers()['content-disposition']).toContain('attachment');
  });

  test('the owner can request deletion and sees what is kept', async ({ page }) => {
    await startAsAhSeng(page);
    await page.goto('/owner/settings');
    await page.getByRole('button', { name: 'Request deletion' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request deletion' });
    await expect(dialog).toContainText('What we keep');
    await expect(dialog).toContainText('balance withdrawn to zero');
    await expectNoOverflow(page);
    await dialog.getByRole('button', { name: 'Send deletion request' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'with our team' })).toBeVisible();
    await expectNoOverflow(page);

    // A second request while one is pending is refused.
    await page.getByRole('button', { name: 'Request deletion' }).click();
    await page
      .getByRole('dialog', { name: 'Request deletion' })
      .getByRole('button', { name: 'Send deletion request' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: /already waiting/ })).toBeVisible();
  });

  test('withdrawing part of the balance lowers it and adds a history line', async ({ page }) => {
    await signInAs(page, 'Ah Seng');
    await giveAhSengABalance(page);
    await page.goto('/owner/money');
    await expectNoOverflow(page);
    const before = await readBalanceSen(page);
    expect(before).toBeGreaterThan(1000);

    await page.getByRole('button', { name: 'Withdraw (Simulated)' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Withdraw to your bank' });
    await expectNoOverflow(page);

    // More than the balance is refused in the sheet.
    await dialog.getByLabel('Amount to withdraw').fill(rm(before + 1).replace('RM ', ''));
    await dialog.getByRole('button', { name: 'Withdraw (Simulated)' }).click();
    await expect(dialog.getByRole('alert')).toContainText(`You can withdraw up to ${rm(before)}.`);

    await dialog.getByLabel('Amount to withdraw').fill('10');
    await dialog.getByRole('button', { name: 'Withdraw (Simulated)' }).click();
    await expect(dialog).toBeHidden();
    const balance = page.getByRole('heading', { name: 'Your BeliKongsi balance' }).locator('..');
    await expectMoney(balance, rm(before - 1000));
    expect(await readBalanceSen(page)).toBe(before - 1000);
    const history = page.getByRole('list').filter({ hasText: 'Withdrawal (simulated)' });
    await expect(history.getByText('Withdrawal (simulated)').first()).toBeVisible();
    await expectMoney(history, 'RM 10.00');
    await expect(history.getByText(/^Reference SIM-WD-/).first()).toBeVisible();
    await expectNoOverflow(page);
  });

  test('savings shows the time saved as Estimated', async ({ page }) => {
    await startAsAhSeng(page);
    await page.goto('/owner/savings');
    const card = page.getByRole('region', { name: /Time saved/ });
    await expect(card).toContainText('Estimated');
    await expectNoOverflow(page);
  });

  test('Ops sees a deletion request with its evidence, and approving is blocked while money is left', async ({
    page,
  }) => {
    await signInAs(page, 'Ah Seng');
    await giveAhSengABalance(page);
    await page.goto('/owner/money');
    const owed = await readBalanceSen(page);
    await page.goto('/owner/settings');
    await page.getByRole('button', { name: 'Request deletion' }).click();
    await page
      .getByRole('dialog', { name: 'Request deletion' })
      .getByRole('button', { name: 'Send deletion request' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'with our team' })).toBeVisible();

    await switchTo(page, 'Nadia');
    const table = page.getByRole('table', {
      name: 'Data deletion requests waiting for a decision',
    });
    const row = table.getByRole('row').filter({ hasText: 'Kedai Kopi Contoh' });
    await expectMoney(row, rm(owed));
    await row.getByRole('button', { name: /^Delete the data of/ }).click();
    const panel = page.getByRole('region', { name: /^Delete the data of/ });
    await expect(panel).toContainText('What is still open');
    await expectMoney(panel, rm(owed));
    await expect(panel).toContainText('Cannot be approved yet');
    await expectNoOverflow(page);

    await panel.getByRole('button', { name: 'Approve deletion' }).click();
    await expect(panel.getByRole('alert')).toContainText('cannot go ahead yet');
    await expectMoney(panel, rm(owed));

    await panel.getByRole('button', { name: 'Reject' }).click();
    await panel.getByLabel('Reason for rejecting (required)').fill('Withdraw the balance first.');
    await panel.getByRole('button', { name: 'Reject' }).first().click();
    await expect(page.getByText('Rejected. The owner can see your reason.')).toBeVisible();
    await expect(table).toBeHidden();
  });
});
