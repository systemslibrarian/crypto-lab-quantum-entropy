import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test'

test('known-prefix model updates its independent entropy and uniformity guarantees', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 })
  await page.goto('.')
  const results = page.locator('#prefix-results')
  await expect(results).toContainText('990 bits')
  await expect(results).toContainText('99.0%')
  await expect(results).toContainText('99.9023%')
  const slider = page.locator('#prefix-d')
  await slider.focus()
  await slider.press('Home')
  await expect(results).toContainText('1000 bits')
  await expect(page.locator('#prefix-d-out')).toHaveText('0')
  await slider.press('End')
  await expect(page.locator('#prefix-d-out')).toHaveText('1000')
  await expect(results).toContainText('0 bits')
  await expect(results).toContainText('below 1')
  await page.getByText('Explain the distinguisher and the exact distance', { exact: true }).click()
  await expect(page.getByText('Check whether the first d bits are all zero.', { exact: false })).toBeVisible()
  const accessibility = await new AxeBuilder({ page }).include('#prefix-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
})
