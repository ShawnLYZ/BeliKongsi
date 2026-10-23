import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { demo, expectMoney, switchTo } from './helpers';

const PHOTO = resolve(import.meta.dirname, '../fixtures/photos/dented-carton.jpg');

test('the PRD §23 demo script, at phone size', async ({ page }) => {
  await test.step('1. Reset, then set up Kedai Kopi Contoh as Ah Seng', async () => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: /Continue with Microsoft/ }).click();
    await page.getByRole('button', { name: /^Ah Seng\b/ }).click();
    await expect(page).toHaveURL(/\/owner$/);

    await demo(page, 'Reset demo data');

    await page.getByRole('link', { name: 'Finish setup' }).click();
    await page.getByRole('button', { name: 'Try with sample data' }).click();
    await page.getByRole('button', { name: 'Read my order' }).click();

    const list = page.getByRole('list', { name: 'Your usual list' });
    await expect(list).toBeVisible({ timeout: 60_000 });
    const eggs = list.getByRole('listitem').filter({ hasText: 'telur 10 papan' });
    // The fake reader always asks; real Gemini may match the eggs line outright.
    if (await eggs.getByText('Please check', { exact: true }).isVisible()) {
      await eggs.getByRole('radio', { name: /Grade A eggs/ }).check();
    }

    const milk = list.getByRole('listitem').filter({ hasText: 'Sweetened condensed milk' });
    await expect(milk.getByLabel('Usual price for one, delivered')).toHaveValue('165.00');
    await expect(milk.getByText('sample price')).toBeVisible();

    await page.getByRole('button', { name: /^Confirm my usual list/ }).click();
    await page.getByRole('radio', { name: /^Ipoh pickup point/ }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('Step 3 of 3: Done')).toBeVisible();
  });

  await test.step('2. Rahim adds a carton of evaporated milk', async () => {
    await switchTo(page, 'Rahim');
    await page.getByRole('link', { name: 'Add to next basket' }).click();
    await page.getByLabel('What does the shop need?').fill('evaporated');
    await page
      .getByRole('list', { name: 'Matching products' })
      .getByRole('button', { name: /^Evaporated milk/ })
      .click();
    await expect(page.getByLabel(/^Quantity of Evaporated milk/)).toHaveValue('1');
    await page.getByRole('button', { name: 'Add to next basket' }).click();
    await expect(
      page
        .getByRole('region', { name: 'My recent additions' })
        .getByRole('listitem')
        .filter({ hasText: 'Evaporated milk' }),
    ).toContainText("Waiting for owner's approval");

    await switchTo(page, 'Ah Seng');
    await page.getByRole('link', { name: "This week's basket" }).first().click();
    await expect(page.getByRole('heading', { name: "This week's basket" })).toBeVisible();
    await expect(
      page.getByRole('article', { name: /^Evaporated milk/ }).getByText('Rahim: +1'),
    ).toBeVisible();
  });

  await test.step('3. Ah Seng checks the price, approves and pays', async () => {
    const milk = page.getByRole('article', { name: /^Sweetened condensed milk/ });
    await milk.getByRole('button', { name: /^Why this price\?/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Why this price?' });
    await expect(sheet).toContainText(
      '99 cartons so far. 1 more carton and everyone pays RM 146.00.',
    );
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: 'Approve & pay' }).click();
    await page.getByRole('tab', { name: 'DuitNow QR' }).click();
    await page.getByRole('button', { name: 'Pay (simulated)' }).click();
    await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
    const receiptLine = page.getByRole('listitem').filter({ hasText: 'Sweetened condensed milk' });
    await expectMoney(receiptLine, 'RM 984.54');

    await page.goto('/owner/rounds');
    const round = page.getByRole('article', { name: /^Sweetened condensed milk/ });
    await expect(round).toContainText('105 cartons so far');
    // Tier 3 is the "100 cartons+" row, marked "Now" while the round is open.
    await expect(
      round
        .getByRole('list', { name: 'Prices: bought alone and Kongsi tiers' })
        .getByRole('listitem')
        .filter({ hasText: '100 cartons+' }),
    ).toContainText('Now');
  });

  await test.step('4. Cut-off: refunds for Ah Seng and Mei', async () => {
    await demo(page, 'Skip to cut-off');
    await page.getByRole('link', { name: /^Notifications/ }).click();
    await expect(page.getByText('RM 73.44 is back in your balance').first()).toBeVisible();

    await switchTo(page, 'Mei');
    await page.getByRole('link', { name: /^Notifications/ }).click();
    await expect(page.getByText('Full refund: RM 123.30').first()).toBeVisible();
  });

  await test.step('5. The supplier order: Nadia approves, Farid confirms and dispatches', async () => {
    await switchTo(page, 'Nadia');
    const orderRow = page
      .getByRole('table', { name: 'Supplier orders waiting for approval' })
      .getByRole('row')
      .filter({ hasText: 'Sweetened condensed milk' });
    await expectMoney(orderRow, 'RM 15,330.00');
    await expect(orderRow).toContainText('✅');
    await orderRow.getByRole('button', { name: /^Sweetened condensed milk/ }).click();
    const panel = page.getByRole('region', { name: /105 cartons/ });
    await expect(panel).toContainText('105 cartons');
    await expectMoney(panel, 'RM 15,330.00');
    await expect(panel.getByRole('definition').filter({ hasText: /^9$/ })).toBeVisible();
    await panel.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved. The order has gone to the supplier.')).toBeVisible();

    await switchTo(page, 'Farid');
    const order = page
      .getByRole('article')
      .filter({ hasText: '105 cartons of Sweetened condensed milk' });
    await order.getByRole('button', { name: 'Confirm' }).click();
    // The date the order asks for (2026-11-07 in the anchored demo week; reset uses this week).
    await expect(order.getByLabel('Dispatch date')).not.toHaveValue('');
    await order.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText(/^Confirmed\. Dispatch on/)).toBeVisible();
    await order.getByRole('button', { name: 'Mark dispatched' }).click();
    await expect(page.getByText(/^Marked dispatched\./)).toBeVisible();

    await switchTo(page, 'Nadia');
    await page.getByRole('link', { name: 'Rounds', exact: true }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Sweetened condensed milk' })
      .getByRole('link', { name: /^Order: Dispatched/ })
      .click();
    await page.getByLabel('Good units').fill('105');
    await page.getByLabel('Damaged units').fill('0');
    await page.getByRole('button', { name: 'Preview allocation' }).click();
    await expect(page.getByRole('heading', { name: /^Allocation preview/ })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText(/^Hub check recorded\./)).toBeVisible();

    await demo(page, 'Complete other rounds');

    await page.getByRole('link', { name: 'Consignments', exact: true }).click();
    const toIpoh = (column: RegExp) =>
      page
        .getByRole('region', { name: column })
        .getByRole('listitem')
        .filter({ hasText: '→ Ipoh pickup point' });
    // The featured round's consignment waits for Nadia; the other rounds' ones have moved on.
    await expect(toIpoh(/^Planned/)).not.toHaveCount(0);
    const planned = toIpoh(/^Planned/);
    const dispatched = toIpoh(/^Dispatched/);
    const waiting = (await planned.count()) + (await dispatched.count());
    for (let left = await planned.count(); left > 0; left -= 1) {
      await planned.first().getByRole('button', { name: 'Mark dispatched' }).click();
      await expect(planned).toHaveCount(left - 1);
    }
    await expect(dispatched).toHaveCount(waiting);
    for (let left = waiting; left > 0; left -= 1) {
      await dispatched.first().getByRole('button', { name: 'Mark arrived' }).click();
      await expect(dispatched).toHaveCount(left - 1);
    }
    await expect(toIpoh(/^Planned/)).toHaveCount(0);
    await expect(toIpoh(/^Dispatched/)).toHaveCount(0);
    await expect(toIpoh(/^Arrived at pickup point/)).not.toHaveCount(0);
  });

  await test.step('6. Rahim collects, reports a dented carton; Nadia approves the claim', async () => {
    await switchTo(page, 'Rahim');
    await page.getByRole('link', { name: 'Confirm delivery' }).click();
    await page
      .getByRole('list', { name: 'Pickups and deliveries' })
      .getByRole('link')
      .first()
      .click();

    const showCode = page.getByRole('button', { name: 'Show code' });
    const codeBox = page.locator(`[id="${await showCode.getAttribute('aria-controls')}"]`);
    await showCode.click();
    const code = (await codeBox.locator('span').nth(1).innerText()).replace(/\s+/g, '');
    expect(code).toMatch(/^\d{6}$/);
    await page.getByLabel('Pickup code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Collected' }).click();
    await expect(page.getByText('Collected.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Report a problem' }).click();
    await page.getByRole('button', { name: /^More: Damaged Sweetened condensed milk/ }).click();
    await page.getByLabel('From gallery').setInputFiles(PHOTO);
    await expect(page.getByText(/1\s+added/)).toBeVisible();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(
      page.getByText('We sent your report to BeliKongsi', { exact: false }),
    ).toBeVisible();

    await switchTo(page, 'Nadia');
    await page
      .getByRole('table', { name: 'Claims waiting for review' })
      .getByRole('link')
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Claim review' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Approved. The refund is in the shop balance.')).toBeVisible();
    await expectMoney(page.getByRole('main'), 'RM 151.85');
  });

  await test.step('7. Close-out: verified savings, a valid log, every money check passed', async () => {
    await switchTo(page, 'Ah Seng');
    await page.getByRole('link', { name: 'Savings', exact: true }).click();
    const saving = page.getByRole('listitem').filter({ hasText: 'Sweetened condensed milk' });
    await expectMoney(saving, 'RM 65.75');
    await expect(saving).toContainText('Verified');

    await switchTo(page, 'Nadia');
    await page.getByRole('link', { name: 'Activity log', exact: true }).first().click();
    await page.getByRole('button', { name: 'Verify log' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Valid \(/ })).toContainText('✅');

    await page.goto('/ops/money');
    const checks = page.getByRole('region', { name: /^Money checks/ });
    await expect(checks.getByRole('heading', { name: /^Money checks/ })).toContainText('✅');
    await expect(checks.getByRole('listitem')).not.toHaveCount(0);
    await expect(checks.getByText('❌')).toHaveCount(0);
  });
});
