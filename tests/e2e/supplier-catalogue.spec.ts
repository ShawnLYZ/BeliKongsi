import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { demo, signInAs, switchTo } from './helpers';

/** Where screenshots go: E2E_SCREENSHOT_DIR when set, else this test's output folder. */
function shotPath(name: string): string {
  const dir = process.env.E2E_SCREENSHOT_DIR ?? test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.png`);
}

/** G9 at phone width: no sideways scroll, 44 px tap targets and a label on every field. */
async function expectPhoneFriendly(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      out.push(`page scrolls sideways by ${root.scrollWidth - root.clientWidth}px`);
    }
    const main = document.getElementById('main')!;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
    };
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40) || el.id}"`;
    const targets = main.querySelectorAll(
      'button, a[href], select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]), label:has(> input[type=checkbox]), label:has(> input[type=file]), summary',
    );
    for (const el of targets) {
      if (!visible(el)) continue;
      const h = el.getBoundingClientRect().height;
      if (h < 44) out.push(`${describe(el)} is ${Math.round(h)}px tall`);
    }
    for (const el of main.querySelectorAll('input, select, textarea')) {
      const field = el as HTMLInputElement;
      const labelled =
        (field.labels?.length ?? 0) > 0 ||
        field.hasAttribute('aria-label') ||
        field.hasAttribute('aria-labelledby');
      if (!labelled) out.push(`${describe(el)} has no label`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}

test('a supplier edits tiers and imports a price list; the open round keeps its price', async ({
  page,
}) => {
  await test.step('1. Farid saves new condensed milk tiers for the next round', async () => {
    await signInAs(page, 'Farid', /\/supplier$/);
    await demo(page, 'Reset demo data');

    await page.getByRole('link', { name: 'Products', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Products and tiers' })).toBeVisible();
    await expectPhoneFriendly(page);
    await page.screenshot({ path: shotPath('1-products'), fullPage: true });

    await page.getByRole('link', { name: 'Edit Sweetened condensed milk 390 g' }).click();
    await expect(
      page.getByRole('heading', { name: 'Sweetened condensed milk 390 g', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(/^Changes apply from the next round \(closes \w{3} \d{1,2} \w{3}\)$/),
    ).toBeVisible();

    // A price that does not fall is flagged next to its row while typing.
    await page.getByLabel('Tier 1 price per carton').fill('157.00');
    await page.getByLabel('Tier 2 price per carton').fill('160.00');
    await expect(page.getByText("Tier 2's price must be less than tier 1's.")).toBeVisible();
    await page.screenshot({ path: shotPath('2-tier-error'), fullPage: true });

    await page.getByLabel('Tier 2 price per carton').fill('151.00');
    await page.getByLabel('Tier 3 price per carton').fill('145.00');
    await expect(page.getByText("Tier 2's price must be less than tier 1's.")).toBeHidden();
    await expect(page.getByLabel('Tier 1 minimum (cartons)')).toHaveValue('20');
    await expect(page.getByLabel('Tier 2 minimum (cartons)')).toHaveValue('50');
    await expect(page.getByLabel('Tier 3 minimum (cartons)')).toHaveValue('100');
    await expectPhoneFriendly(page);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByText(/^Saved\. Owners see the change from the round closing/),
    ).toBeVisible();
    await expect(page.getByLabel('Tier 1 price per carton')).toHaveValue('157.00');

    await page.goto('/supplier/products');
    const cm = page.getByRole('listitem').filter({ hasText: 'Sweetened condensed milk 390 g' });
    await expect(cm).toContainText('RM 157.00');
    await expect(cm).toContainText('RM 151.00');
    await expect(cm).toContainText('RM 145.00');
  });

  await test.step('2. Farid imports the sample price list', async () => {
    await page.getByRole('link', { name: 'Import a price list' }).click();
    await expect(
      page.getByText('The photo is sent to our AI provider; cover any personal details.'),
    ).toBeVisible();
    await expectPhoneFriendly(page);
    await page.screenshot({ path: shotPath('3-import'), fullPage: true });

    await page.getByRole('button', { name: 'Try with sample data' }).click();
    await expect(page.getByText('Made-up data', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Read price list' }).click();

    const review = page.getByRole('list', { name: 'Drafted price list' });
    await expect(review).toBeVisible({ timeout: 60_000 });
    const milk = review.getByRole('listitem').filter({ hasText: 'Susu pekat manis' });
    await expect(milk.getByRole('table')).toContainText('RM 157.00');
    const oil = review.getByRole('listitem').filter({ hasText: 'Minyak masak' });
    await expect(oil).toContainText("Tier 2's price must be less than tier 1's.");
    await expect(review.getByRole('listitem').filter({ hasText: 'Gula pasir' })).toContainText(
      'New product',
    );

    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirm).toBeDisabled();
    await expectPhoneFriendly(page);
    await page.screenshot({ path: shotPath('4-review-blocked'), fullPage: true });

    await oil.getByRole('checkbox').uncheck();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Price list saved' })).toBeVisible();
    await expect(page.getByText(/^3 products updated/)).toBeVisible();
    await page.screenshot({ path: shotPath('5-import-saved'), fullPage: true });
  });

  await test.step('3. Ah Seng is still quoted the open round price', async () => {
    await switchTo(page, 'Ah Seng');
    await page.goto('/owner/rounds');
    const round = page.getByRole('article', { name: /^Sweetened condensed milk/ });
    // The open round keeps the tiers it opened with.
    await expect(round).toContainText('RM 158.00');
    await round.getByRole('link', { name: /^See details/ }).click();
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Join this Kongsi' });
    await sheet
      .getByLabel('Quantity of Sweetened condensed milk 390 g (cartons)', { exact: true })
      .fill('6');
    await expect(sheet).toContainText('6 cartons at RM 164.09');
    await page.screenshot({ path: shotPath('6-owner-quote'), fullPage: true });
  });
});
