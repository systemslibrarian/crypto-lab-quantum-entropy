import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { auditControlNames, formatControlNameFailures } from './control-names'

test('failure workshop exposes misses, threshold changes, and source credit', async ({ page }) => {
  await page.goto('./')
  await page.locator('#hw-failure').selectOption('alternating')
  await expect(page.locator('#hw-result')).toContainText('Detected 0 /')
  await page.locator('#hw-failure').selectOption('stuck')
  await expect(page.locator('#hw-result')).toContainText('Detected 64 / 64')
  await page.locator('#hw-window').selectOption('128')
  await page.locator('#hw-cutoff').fill('50')
  await page.locator('#hw-run').click()
  await expect(page.locator('#hw-result')).toContainText('64 / 64 trials alarmed before the failure')
  await page.locator('#hw-preset').click()
  await expect(page.locator('#panel-health-workshop')).toContainText('Joshua E. Hill')
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).include('#panel-health-workshop').analyze()).violations).toEqual([])
  // axe's `label` rule accepts a bare `placeholder` as an accessible name, so a
  // deleted label can leave this gate green. See `control-names.ts`.
  expect(formatControlNameFailures(await auditControlNames(page)), 'form controls named only by placeholder/title in the failure workshop').toEqual([])
})
