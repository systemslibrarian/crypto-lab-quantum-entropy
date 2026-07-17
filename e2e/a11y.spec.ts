import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Drive every panel into its post-interaction states before scanning — axe only
 * checks what is in the DOM, and the alarm/verdict states are exactly where
 * contrast and live-region violations hide.
 */
async function driveDemos(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  })

  // 1. Source: emit a fresh stream at the default 53/47 device
  await page.getByRole('button', { name: /Emit 4,096 photons/ }).click()

  // 2. von Neumann: step the animation, then run it to the end
  await page.locator('#vn-step').click()
  await page.locator('#vn-step').click()
  await page.locator('#vn-run').click()
  await page.waitForTimeout(500)

  // 3. Toeplitz, healthy accounting: extract at the default m = 128 (OK verdict)
  await page.locator('#tp-extract').click()

  // 4. Toeplitz, broken accounting: demand m = 256 from ~234 bits (ALARM verdict)
  await page.locator('#tp-m').fill('256')
  await page.locator('#tp-extract').click()

  // 5. von Neumann break-it: correlated source → bias PASS + verdict REJECT together
  await page.locator('#vn-break').click()
  await page.locator('#vn-run').click()
  await page.waitForTimeout(500)

  // 6. Health tests break-it: stuck detector → RCT/APT FAIL + latched gate states
  await page.locator('#ht-stick').click()
  await page.waitForTimeout(200)

  // 7. Repair, recommission (unlatches the alarm), and restore independence so
  //    healthy, broken, and recommissioned states all got scanned
  await page.locator('#ht-unstick').click()
  await page.locator('#ht-reset').click()
  await page.locator('#vn-fix').click()

  // 8. Reveal all progressive-disclosure content
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => {
      d.open = true
    })
  })
  await page.waitForTimeout(300)
}

async function scan(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([])
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.')
  await driveDemos(page)
  await scan(page)
})

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.')
  await page.locator('#cl-theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await driveDemos(page)
  await scan(page)
})

test('no WCAG A/AA violations — dark theme, stuck-source alarm state', async ({ page }) => {
  await page.goto('.')
  await page.locator('#ht-stick').click()
  await page.waitForTimeout(200)
  // the latched alarm must block the extractor (fail-closed source boundary)
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await scan(page)
})

test('health gate: repair + recommission unlatches and re-enables extraction', async ({ page }) => {
  await page.goto('.')
  await page.locator('#ht-stick').click()
  await expect(page.locator('#tp-extract')).toBeDisabled()
  // repair alone is not enough — the alarm is latched until an operator resets it
  await page.locator('#ht-unstick').click()
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await page.locator('#ht-reset').click()
  await expect(page.locator('#tp-extract')).toBeEnabled()
})

for (const width of [320, 390, 768]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('.')
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
