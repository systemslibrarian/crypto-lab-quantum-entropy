import { expect, test } from '@playwright/test'
import { boot, scan, reportCollected } from './gate'
for (const theme of ['dark'] as const) {
  test(`KDF supported routes and refusals remain usable in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 320, height: 900 })
    await boot(page, theme)
    await page.goto('#kdf-calculator')
    const bound = page.locator('[data-kdf-bound]')
    const result = page.locator('#kdf-result')
    await expect(bound).toHaveText('65 × 2^−64')
    await page.locator('#kdf-calculator').scrollIntoViewIfNeeded()
    await scan(page, 'KDF no-loss')
    await page.locator('#kdf-example-138').click()
    await expect(bound).toHaveText('3 × 2^−64')
    await scan(page, 'KDF small-loss')
    await page.locator('#kdf-k').fill('137')
    await expect(result).toContainText('does not interpolate')
    await expect(bound).toHaveCount(0)
    await scan(page, 'KDF unsupported gap')
    await page.locator('#kdf-example-128').click()
    await page.locator('#kdf-r').fill('64')
    await expect(result).toContainText('at least 65-wise')
    await page.locator('#kdf-r').fill('65')
    for (const [id, value, message] of [
      ['game', 'indistinguishability', 'specified unpredictability'],
      ['seed', 'other', 'uniform, public and independent'],
      ['family', 'hkdf', 'not bounds for HKDF'],
    ]) {
      await page.locator(`#kdf-${id}`).selectOption(value)
      await expect(result).toContainText(message)
      await expect(bound).toHaveCount(0)
      await page.locator('#kdf-example-128').click()
    }
    await page.locator('#kdf-model').uncheck()
    await expect(result).toContainText('unverified real-world inputs')
    await expect(bound).toHaveCount(0)
    await page.locator('#kdf-model').check()
    await page.locator('#kdf-b').fill('')
    await expect(bound).toHaveCount(0)
    await page.locator('#kdf-example-138').click()
    await page.getByText('Explain the two routes and their limits', { exact: true }).click()
    await scan(page, 'KDF explanation expanded')
    await page.setViewportSize({ width: 1280, height: 900 })
    await scan(page, 'KDF desktop expanded')
    reportCollected()
  })
}
test('KDF direct link reaches the calculator', async ({ page }) => {
  await page.goto('./#kdf-calculator')
  await expect(page.locator('#kdf-h')).toBeInViewport()
  await expect(page.locator('[data-kdf-bound]')).toHaveText('65 × 2^−64')
})
