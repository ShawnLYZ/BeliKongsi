import { expect, test } from '@playwright/test';

test('the home page sends a signed-out visitor to the simulated sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with Microsoft/ })).toBeVisible();
});
