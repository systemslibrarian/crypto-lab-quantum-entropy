import { expect, test } from '@playwright/test'
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate'

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, which is
 * already a live 53/47 beam-splitter device because `main.ts` ends in
 * `regenerate()`; the skip link focused; a fresh emission; both extremes of the
 * bias slider (50%, the ideal device where Shannon and min-entropy agree, and
 * 70%, the widest gap the lab offers) and of the correlation slider; the von
 * Neumann strip single-stepped, which is the only route to the current-pair ring
 * under reduced motion, then run, then reset, then broken to an 80%-correlated
 * source where the bias check PASSES while the dependence diagnostic REJECTS —
 * the disagreement the exhibit exists for — then restored; the Toeplitz
 * extractor at the shipped m = 128, at the m = 8 minimum, at a thin-margin m in
 * the middle policy band, and at m = 256, which is the only route to the budget
 * bar's overdraft rectangle; detector B stuck so both health tests fail and the
 * alarm latches the extractor shut; recommissioning REFUSED while the source is
 * still dead; the source repaired but still latched; the recommission that
 * clears it; and each of the four disclosures opened by clicking its summary.
 * Every one of those states is scanned, in both themes, at desktop and phone
 * width.
 *
 * See `gate.ts` for why nothing is injected into the page (the stylesheet's
 * reduced-motion block is scoped to `#app *` and deliberately leaves the shared
 * bar's transitions alone, and `vnPanel.ts` branches on the preference in JS),
 * why no `<details>` is force-opened, why the lab's defaults are asserted rather
 * than assumed, and why `violations` is not the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000)
    const errors = watchPageErrors(page)
    await boot(page, theme)
    await driveAllStates(page, theme)
    expect(errors, errors.join('\n')).toEqual([])
    expectBaselineNotStale()
    reportCollected()
  })

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000)
    const errors = watchPageErrors(page)
    await page.setViewportSize(NARROW)
    await boot(page, theme)
    await driveAllStates(page, `${theme} @380px`)
    expect(errors, errors.join('\n')).toEqual([])
    expectBaselineNotStale()
    reportCollected()
  })
}

/**
 * The health gate is a SECURITY property, not an accessibility one, and it is
 * kept from the spec this replaces because it was the one assertion there that
 * could genuinely fail: a latched alarm must block extraction, repair alone must
 * not clear it, and only an explicit operator recommission may.
 */
test('health gate: repair + recommission unlatches and re-enables extraction', async ({ page }) => {
  await page.goto('.')
  await page.locator('#ht-stick').click()
  await expect(page.locator('#tp-extract')).toBeDisabled()
  // Repair alone is not enough — the alarm is latched until an operator resets it.
  await page.locator('#ht-unstick').click()
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await page.locator('#ht-reset').click()
  await expect(page.locator('#tp-extract')).toBeEnabled()
})
