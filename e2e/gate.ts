import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { auditContrast, formatContrastFailures } from './contrast'
import { auditNonText } from './nontext'
import { NONTEXT_BASELINE } from './nontext-baseline'

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 }

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, each one a correction of the gate this
 * replaces (`e2e/a11y.spec.ts` as it stood before this commit):
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. `driveDemos()` opened by
 *     pushing `animation:none!important; transition:none!important` through
 *     `addStyleTag` into every element and pseudo-element. That BYPASSED this
 *     stylesheet's own `@media (prefers-reduced-motion: reduce)` block instead
 *     of exercising it — and the injected form was not even the same rule: the
 *     stylesheet's block is scoped to `#app *`, so the shared top bar's
 *     `transition: background .15s, border-color .15s, color .15s` and the skip
 *     link's `transition: top .15s ease` are deliberately left running for a
 *     reader who asked for reduced motion, while the injection killed them.
 *
 *     It could not reach the JS either. `vnPanel.ts`'s "Run remaining pairs"
 *     reads `matchMedia('(prefers-reduced-motion: reduce)')` and, when set,
 *     jumps the pair strip straight to its end state rather than stepping it on
 *     a 140ms `setInterval`. The old gate therefore never scanned the branch a
 *     reduced-motion reader actually gets, and covered the other one with a
 *     `waitForTimeout(500)` — which is not a completion signal, just a guess.
 *
 *  2. IT FORCE-REVEALED EVERY DISCLOSURE. Its last step set `open = true` on
 *     every `<details>` from script. This gate never touches `open`; all four
 *     disclosures are opened by clicking their own `<summary>`, which is also
 *     the only way to find out whether the summary is reachable and operable.
 *
 *  3. IT SCANNED ONCE, PER THEME, AFTER THE WHOLE DRIVE. Every state
 *     `driveDemos()` built was overwritten before anything measured it — the
 *     healthy m = 128 extraction, the m = 256 overdraft, the stuck-detector
 *     alarm, the correlated von Neumann run — because `scan()` ran only at the
 *     end, after the repair-and-recommission steps had put the page back to
 *     something close to its arrival state. The separate 320/390/768px tests
 *     measured ONLY document overflow, only at first paint, with no drive and
 *     no axe. This drive scans after every single step, in
 *     {dark, light} × {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. Two things on this page
 *     are invisible to a violations-only assertion in particular: the entropy
 *     budget bar's labels sit on `color-mix(in oklab, …)` fills that axe
 *     declines to resolve and files under `incomplete`; and
 *     `aria-prohibited-attr` — where an `aria-label` on a role-less element
 *     hides — never reaches the violations array at all.
 *
 *  5. IT HAD NO CONTRAST, KEYBOARD-SCROLLER OR NON-TEXT ORACLE. This page needs
 *     all three: three `.bitscroll` regions scroll under a 7.5rem cap, and the
 *     lab's verdict colours (`--ok-ink`, `--warn-ink`, `--danger-ink`) are the
 *     entire difference between "PASS" and "ALARM" in eight verdict boxes.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number }
      const running = document.getAnimations().filter((a) => a.playState === 'running')
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0
      return w.__quietFrames >= 6
    },
    undefined,
    { timeout: 20_000, polling: 'raf' },
  )
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * This page cannot currently be in that shape, and the assertion is what makes
 * that a measurement rather than a reading: `style.css` contains no
 * `@keyframes`, no `animation` shorthand and not one `opacity` declaration
 * anywhere in it, so its reduced-motion block has nothing to strand. All three
 * of those are properties of the CURRENT stylesheet rather than of the page,
 * and every panel here renders through `innerHTML` on subscribe — so a
 * "de-emphasised until computed" state is one commit away, and this is the
 * cheapest place to catch the first one.
 *
 * `aria-hidden` subtrees are excluded. On this page that costs almost nothing:
 * the whole hidden set is four `→` pipeline arrows and the shared header's two
 * glyph-free SVG marks (see the note in `contrast.ts`).
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim()
      if (!own) continue
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue
      if (el.closest('[aria-hidden="true"]')) continue
      let effective = 1
      let node: Element | null = el
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity)
        node = node.parentElement
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`)
      }
    }
    return Array.from(new Set(out))
  })
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([])
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created.
 *
 * This matters more here than in most labs. `dom.ts`'s `$()` THROWS on a
 * missing selector, and every panel re-renders through it on each `subscribe`
 * callback — so a renamed id does not degrade, it aborts the listener mid-run
 * and leaves the previous state on screen while the panels after it in the
 * subscriber list never update at all. A gate that only looks at the DOM would
 * scan that stale page and report green. Attach before `boot`, assert after the
 * drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  return errors
}

/**
 * Exactly one banner landmark: the shared bar.
 *
 * This page puts its hero INSIDE `<main id="app">`, which scopes the hero
 * `<header class="cl-hero">` out of the banner role on its own — and
 * `index.html`'s `dedupeBanner()` explicitly skips it for that reason
 * (`el.closest('main, …')` returns early). So nothing here demotes anything;
 * the single banner is a property of the markup. Asserting the OUTCOME rather
 * than either mechanism means a change to the nesting is caught too.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION'])
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true
      if (el.tagName !== 'HEADER') return false
      if (el.getAttribute('role')) return false // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false
      return true
    }
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length
  })
  expect(banners, 'exactly one banner landmark').toBe(1)
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which also pins down a real failure mode: `index.html`'s anti-flash
 * script reads `localStorage.getItem('theme')` and the shared bar's toggle
 * writes `localStorage.setItem('theme', …)`. If those keys drift apart the
 * theme silently stops persisting, and this boot fails on `data-theme` rather
 * than quietly scanning dark twice — which is what the gate this replaces did
 * for its first test, since it never seeded a theme at all.
 *
 * The defaults are asserted at length because this lab arrives FULLY POPULATED
 * and its arrival state is a specific device: `main.ts` ends with
 * `regenerate()`, so a 4,096-bit stream from a 53/47 beam splitter with zero
 * correlation is already measured, debiased, and health-checked before the
 * reader touches anything. Which half of this lab a scan sees depends entirely
 * on that configuration — a stuck detector, a correlated source and an
 * over-demanded extraction all paint inks the default state never shows.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
  await page.goto('.')
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect',
  ).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await assertSingleBanner(page)

  // Every panel body is written by `src/ui/*.ts` into an empty `<section>`, so a
  // navigation that resolves proves nothing about what is on screen.
  await expect(page.locator('#app section.panel')).toHaveCount(7)
  for (const id of ['source-h', 'entropy-h', 'vn-h', 'toeplitz-h', 'health-h']) {
    await expect(page.locator(`#${id}`)).toBeVisible()
  }

  // ── The arrival device: 53/47, independent, healthy ──────────────────────
  await expect(page.locator('#src-bias')).toHaveValue('53')
  await expect(page.locator('#src-corr')).toHaveValue('0')
  await expect(page.locator('#src-bias-out')).toHaveText('53%')
  await expect(page.locator('#src-corr-out')).toHaveText('0%')
  await expect(page.locator('#src-stick')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#src-stick')).toHaveText('Stick detector B (failure)')
  await expect(page.locator('#tp-m')).toHaveValue('128')
  await expect(page.locator('#tp-m-out')).toHaveText('128')

  // A stream really was generated on load — all three panels that measure it
  // have content, and the extractor has not been run.
  await expect(page.locator('#src-stream')).not.toBeEmpty()
  await expect(page.locator('#vn-out')).not.toBeEmpty()
  await expect(page.locator('#src-stats .stat')).toHaveCount(4)
  await expect(page.locator('#tp-output')).toHaveText(/press .Draw fresh seed/)

  // Health starts commissioned and unlatched, so the extractor accepts input.
  await expect(page.locator('#tp-extract')).toBeEnabled()
  await expect(page.locator('#tp-gate-note')).toBeEmpty()
  await expect(page.locator('#ht-reset-note')).toBeEmpty()
  await expect(page.locator('#ht-verdicts .verdict-box.alarm')).toHaveCount(0)

  // Four inline disclosures, all shut. `driveDemos()` used to open them from
  // script; here they are only ever opened by clicking their summary.
  await expect(page.locator('#app details')).toHaveCount(4)
  await expect(page.locator('#app details[open]')).toHaveCount(0)

  await settle(page)
  await expectNotBlank(page, `${theme} first paint`)
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. The old spec did
 * check it — at 320, 390 and 768px — but only on the arrival state, with no
 * drive and no axe beside it, so the states that actually get wide were never
 * measured: the `.vn-strip` of 24 pair chips, the `auto-fit minmax(11rem, 1fr)`
 * stat grids, the `minmax(15rem, 1fr)` verdict pairs, the three fixed-viewBox
 * SVG figures and the `.arch-flow` pipeline row.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    if (doc.scrollWidth <= doc.clientWidth) return null

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element, and every
    // `.bitscroll` here is exactly that decoy.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
        n = n.parentElement
      }
      return false
    }

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right)
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0]
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    }
  })
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull()
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * This lab already handles its known case: all three `.bitscroll` regions are
 * written with `tabindex="0"`, `role="region"` and an `aria-labelledby` pointing
 * at the `<h3>` above them. The assertion stays because that is a convention
 * repeated by hand in three separate files rather than an enforcement, and
 * because those three regions hold the raw stream, the debiased output and the
 * extracted output — which is every bit this lab produces.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el)
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`,
      )
  })
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`,
  ).toEqual([])
}

/**
 * SC 1.4.11 (non-text contrast) for interactive controls: a control's boundary
 * has to be perceivable against what surrounds it.
 *
 * The gate this replaces had no such check at all. It is needed here because
 * this lab's controls are drawn three different ways — a filled primary
 * `#app button`, a transparent `.secondary` that is nothing BUT its border, and
 * two `input[type=range]` sliders — and only the first of those carries its own
 * fill.
 *
 * A control passes if EITHER
 *   - its fill differs from the surface behind it, or
 *   - it has a border that stands out from the surface behind it AND from its
 *     own fill.
 * so the score is `max(fill-vs-outside, min(border-vs-outside, border-vs-fill))`.
 * Taking the max of the two mechanisms is what keeps this from failing a
 * perfectly delineated solid button for having no border.
 *
 * Two deliberate exclusions:
 *  - `disabled` controls. WCAG exempts inactive components, and `#tp-extract`
 *    ships enabled but is disabled for as long as a health alarm is latched.
 *  - anything outside `#app`. The shared top bar is not this lab's to change —
 *    every repo in the fleet carries a copy — and its `.cl-btn` boundary
 *    measures 2.45:1 against the bar's fixed `#0b1512`. That is recorded in
 *    `nontext-baseline.ts` and reported upward rather than patched in one repo,
 *    so the exclusion is a decision and not an oversight.
 *
 * `input[type=range]` is excluded from the BORDER half of the test rather than
 * from the test: a range input paints its track and thumb from `accent-color`
 * through UA pseudo-elements that `getComputedStyle` on the host cannot see, so
 * its border and background are not what a reader looks at. Those two sliders
 * are hand-measured instead, with the numbers in the commit.
 */
export async function auditControlBoundaries(
  page: Page,
): Promise<Array<{ sel: string; ratio: number }>> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number }
    // Resolve through a canvas rather than a regex: this palette uses
    // `color-mix()` and `rgba()`, which `getComputedStyle` reports unchanged and
    // which a regex reads as null — landing the walk on the wrong backdrop.
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const parse = (s: string): C => {
      if (!s) return { r: 0, g: 0, b: 0, a: 0 }
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = s
      const a = ctx.fillStyle
      ctx.fillStyle = '#fff'
      ctx.fillStyle = s
      if (a !== ctx.fillStyle) return { r: 0, g: 0, b: 0, a: 0 }
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = s
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
    }
    const over = (fg: C, bg: C): C => {
      const a = fg.a + bg.a * (1 - fg.a)
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      }
    }
    const lum = (c: C): number => {
      const f = (v: number): number => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const ratio = (a: C, b: C): number => {
      const la = lum(a)
      const lb = lum(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    const backdrop = (start: Element | null): C => {
      const stack: C[] = []
      for (let n = start; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c.a > 0) {
          stack.push(c)
          if (c.a >= 1) break
        }
      }
      let out: C = { r: 255, g: 255, b: 255, a: 1 }
      for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out)
      return out
    }
    const describe = (el: Element): string => {
      const cls = el.getAttribute('class')
      return (
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : '') +
        (cls ? `.${cls.trim().split(/\s+/).join('.')}` : '')
      )
    }

    const out: Array<{ sel: string; ratio: number }> = []
    const app = document.getElementById('app')
    if (!app) return out
    app.querySelectorAll<HTMLElement>('button, select, textarea, input:not([type="range"])').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      if ((el as HTMLButtonElement).disabled) return
      if (el.closest('[hidden]')) return
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') return
      const outside = backdrop(el.parentElement)
      const fillRaw = parse(cs.backgroundColor)
      const fill = fillRaw.a > 0 ? over(fillRaw, outside) : outside
      const byFill = ratio(fill, outside)
      let byBorder = 1
      if (parseFloat(cs.borderTopWidth) > 0) {
        const border = over(parse(cs.borderTopColor), fill)
        byBorder = Math.min(ratio(border, outside), ratio(border, fill))
      }
      out.push({
        sel: describe(el),
        ratio: Math.round(Math.max(byFill, byBorder) * 100) / 100,
      })
    })
    return out
  })
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the committed
 * workflow, and a run with it set prints every finding as it happens and then
 * fails at the end, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT
const collected: string[] = []

function record(entry: string): void {
  collected.push(entry)
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`)
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected)
    return
  }
  try {
    expect(actual, message).toEqual(expected)
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`)
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([])
}

async function expectScrollersReachableSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectScrollersReachable(page, label)
  try {
    await expectScrollersReachable(page, label)
  } catch (e) {
    record(String(e).slice(0, 900))
  }
}

/**
 * The 1.4.11 ratchet, soft-wrapped the same way as every other oracle here.
 *
 * The wrapper is deliberately shaped so the real call cannot end up on the wrong
 * side of a `COLLECTING` guard: fleet-wide, `expectNoNewNonTextFailures` was
 * reachable only from inside `expectScrollersReachableSoft`, AFTER that
 * function's `if (!COLLECTING) return …`, so in a strict run — which is every
 * run in CI and every run anyone reads as a pass — `nontext.ts` never executed
 * at all. It is called from `scan()` here, at every driven state.
 */
async function expectNoNewNonTextFailuresSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoNewNonTextFailures(page, label)
  try {
    await expectNoNewNonTextFailures(page, label)
  } catch (e) {
    record(String(e).slice(0, 900))
  }
}

async function expectNoHorizontalOverflowSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoHorizontalOverflow(page, label)
  try {
    await expectNoHorizontalOverflow(page, label)
  } catch (e) {
    record(String(e).slice(0, 900))
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate. So it ratchets: anything NOT in the baseline fails,
 * anything in the baseline that got WORSE fails, and anything in the baseline
 * that has been FIXED fails until its entry is deleted. That last rule is what
 * stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>()

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page)
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(
        `NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`,
      )
    }
    return
  }
  const problems: string[] = []
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`
    nonTextSeen.add(key)
    const base = NONTEXT_BASELINE[key]
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`)
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`)
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([])
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k))
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)',
  ).toEqual([])
}

/**
 * Scan the page as it currently stands.
 *
 * Seven assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those ratios
 *    arithmetically. Everything else in that bucket is a real result axe simply
 *    could not finish — including `aria-prohibited-attr`, which is where an
 *    `aria-label` on a role-less element hides, a defect that never reaches the
 *    violations array at all. This page has the shape that produces it: three
 *    `<div class="bitscroll">`s carry an `aria-labelledby` and are made legal
 *    only by a `role="region"` written beside it, and the role is easy to drop.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast for interactive controls — SC 1.4.11, which axe has no
 *    rule for; see `auditControlBoundaries`.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page)
  await expectNotBlank(page, label)
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass; thirteen repos in this fleet had shipped
  // that form. Running the two sets separately and merging is the only way to
  // have both. The landmark four are wanted because they are best-practice
  // rather than WCAG-tagged, so `withTags` alone does not reach them, and this
  // page has the shape they catch: a shared sticky `<header role="banner">`
  // above a `<main>` that contains a second `<header>` with an
  // `<aside aria-label="Why it matters">` inside it.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze()
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  }

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }))
  softExpect(violations, `axe violations in state: ${label}`, [])

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }))
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, [])

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))))
  softExpect(contrast, `measured contrast failures in state: ${label}`, [])

  const boundaries = await auditControlBoundaries(page)
  expect(boundaries.length, `no controls found to measure in state: ${label}`).toBeGreaterThan(0)
  const undelineated = Array.from(
    new Set(boundaries.filter((b) => b.ratio < 3).map((b) => `${b.ratio}:1 ${b.sel}`)),
  )
  softExpect(undelineated, `control boundaries under 3:1 (SC 1.4.11) in state: ${label}`, [])

  await expectNoNewNonTextFailuresSoft(page, label)
  await expectScrollersReachableSoft(page, label)
  await expectNoHorizontalOverflowSoft(page, label)
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Open one `<details>` by clicking its summary, and assert it opened. */
async function openDisclosure(page: Page, index: number): Promise<void> {
  const d = page.locator('#app details').nth(index)
  await d.locator('summary').click()
  await expect(d).toHaveAttribute('open', '')
}

/**
 * Move a range input to a value and wait for the `change` handler to land.
 *
 * The sliders here are deliberately two-stage: `input` updates only the
 * `<output>` label, and `change` commits the model and regenerates the whole
 * stream. `fill()` fires both, so the assertion on the committed side is what
 * distinguishes "the label moved" from "the lab re-ran".
 */
async function setSlider(page: Page, id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).fill(value)
  await page.locator(`#${id}`).dispatchEvent('change')
  await expect(page.locator(`#${id}`)).toHaveValue(value)
}

/**
 * Drive the lab through every state it can render, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE ARRIVAL STATE IS A DEVICE, AND IT IS SCANNED FIRST. `main.ts` calls
 *    `regenerate()` on load, so a 53/47 independent source is already measured,
 *    debiased and health-checked. That is one configuration out of many, and
 *    which inks a scan sees depends entirely on it.
 *
 *  - BOTH EXTREMES OF BOTH SLIDERS. The bias slider spans 50–70% and the
 *    correlation slider 0–90%, and the panels change VERDICT across that range,
 *    not just numbers: at 50/0 the min-entropy box reads `ok`, and past the
 *    gap threshold or with any correlation it reads `warn` and switches to the
 *    dependence wording. Driving only the shipped default measures one of them.
 *
 *  - EVERY BRANCH OF THE EXTRACTOR'S POLICY VERDICT. `ε` decides between three
 *    renderings — `ok` below 2⁻³², `warn` below 2⁻¹⁰, `alarm` above — and the
 *    `alarm` branch is also the only route to the budget bar's OVERDRAFT
 *    rectangle and its `--danger-ink` label, a whole figure that does not exist
 *    at the shipped m = 128.
 *
 *  - THE FAILURE, THE REPAIR, AND THE REFUSAL. Sticking detector B latches a
 *    health alarm, which disables `#tp-extract` and paints the source-boundary
 *    box; repairing alone does NOT unlatch it; and pressing recommission while
 *    the source is still dead produces the one refusal message in the lab.
 *    All four of those are separate renderings and none had been scanned.
 *
 *  - THE ANIMATION STATES OF THE VON NEUMANN STRIP. `.vn-pair` renders as
 *    `pending`, `current`, `emitted` or `dropped`, and `current` — a 2px
 *    accent ring — exists only between a step and the next one. Under the
 *    reduced motion this gate asserts, "Run remaining pairs" jumps straight to
 *    the end, so single-stepping is the only way to paint it at all.
 *
 *  - NO FIXED TIMEOUTS. The old drive used `waitForTimeout(500)` and
 *    `waitForTimeout(200)` three times between steps. Every action here is
 *    synchronous in the page — `setConfig` regenerates and emits before it
 *    returns — so the drive waits on the rendered consequence instead.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`)

  await scanAt('first paint, 53/47 independent source, commissioned and healthy')

  // The shared skip link is revealed only by a keyboard Tab (it lives at
  // `top: -3rem` until focused), and it is the first focusable thing on the page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('Tab')
  await expect(page.locator('a.cl-skip-link')).toBeFocused()
  await scanAt('shared skip link focused')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

  // ── Panel 1 — the source ─────────────────────────────────────────────────
  await page.locator('#src-generate').click()
  await expect(page.locator('#src-stream')).not.toBeEmpty()
  await scanAt('fresh stream emitted at the default device')

  // Both extremes of the bias slider. 50% is the ideal device (the only state
  // where Shannon and min-entropy agree); 70% is the widest gap the lab offers.
  await setSlider(page, 'src-bias', '50')
  await expect(page.locator('#src-bias-out')).toHaveText('50%')
  await scanAt('bias at the 50% minimum — an ideal device')
  await setSlider(page, 'src-bias', '70')
  await expect(page.locator('#src-bias-out')).toHaveText('70%')
  await scanAt('bias at the 70% maximum — the widest Shannon/min-entropy gap')
  await setSlider(page, 'src-bias', '53')

  // Both extremes of the correlation slider. 90% is the only state that drives
  // every dependence branch at once — and it also trips the SP 800-90B
  // Repetition Count Test, which is a genuine cross-panel consequence the old
  // drive never produced. The cutoff commissioned for the default 53/47 device
  // is C = 1 + ceil(20 / 0.916) = 23 identical samples; at 90% persistence a run
  // that long starts with probability 0.9^22 ≈ 0.098 at any position, so over
  // 4,096 samples the expected number of trips is in the tens and the latch is
  // deterministic in every practical sense. Asserting it is what turns "the
  // extractor happens to be blocked here" into a stated property.
  await setSlider(page, 'src-corr', '90')
  await expect(page.locator('#src-corr-out')).toHaveText('90%')
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await expect(page.locator('#tp-gate-note')).not.toBeEmpty()
  await scanAt('correlation at the 90% maximum — dependence detected, RCT tripped')
  await setSlider(page, 'src-corr', '0')
  // The alarm LATCHES: a clean source does not clear it, only an operator does.
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await scanAt('correlation restored to 0% but the health alarm is still latched')

  // ── Panel 3 — von Neumann ────────────────────────────────────────────────
  // Single-stepping is the only route to `.vn-pair.current`; under reduced
  // motion "Run remaining pairs" jumps straight past it.
  await page.locator('#vn-step').click()
  await expect(page.locator('.vn-pair.current')).toHaveCount(1)
  await scanAt('von Neumann stepped one pair, current-pair ring painted')
  for (let i = 0; i < 3; i += 1) await page.locator('#vn-step').click()
  await scanAt('von Neumann stepped four pairs')
  await page.locator('#vn-run').click()
  await expect(page.locator('.vn-pair.current')).toHaveCount(0)
  await scanAt('von Neumann strip run to the end')
  await page.locator('#vn-reset').click()
  await expect(page.locator('.vn-pair.pending').first()).toBeVisible()
  await scanAt('von Neumann animation reset, every pair pending')

  // The exhibit's whole point: a correlated source where the bias check PASSES
  // and the dependence diagnostic REJECTS, side by side.
  await page.locator('#vn-break').click()
  await expect(page.locator('#src-corr')).toHaveValue('80')
  await expect(page.locator('#vn-verdicts .verdict-box.alarm')).toHaveCount(1)
  await scanAt('streaky source — bias passes while dependence rejects')
  await page.locator('#vn-run').click()
  await scanAt('streaky source, strip run to the end')
  await page.locator('#vn-fix').click()
  await expect(page.locator('#src-corr')).toHaveValue('0')
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await scanAt('independent source restored, alarm still latched')

  // Recommission, so panel 4 can be driven at all. This is the operator action
  // the lab models, and it is required here rather than incidental: every
  // correlated state above latched the health alarm, and a latched alarm blocks
  // the extractor by design.
  await page.locator('#ht-reset').click()
  await expect(page.locator('#tp-extract')).toBeEnabled()
  await expect(page.locator('#ht-reset-note')).toBeEmpty()
  await scanAt('recommissioned after the correlated run — extraction re-enabled')

  // ── Panel 4 — the Toeplitz extractor ─────────────────────────────────────
  await page.locator('#tp-extract').click()
  await expect(page.locator('#tp-output')).toHaveText(/^hex: /)
  await expect(page.locator('#tp-matrix rect').first()).toBeVisible()
  await scanAt('extracted at the shipped m = 128')

  await setSlider(page, 'tp-m', '8')
  await page.locator('#tp-extract').click()
  await expect(page.locator('#tp-m-out')).toHaveText('8')
  await scanAt('extracted at the m = 8 minimum — the widest security margin')

  // The overdraft: m beyond the model's min-entropy is the only route to the
  // budget bar's red rectangle, its `--danger-ink` "overdraft" label, and the
  // policy box's REJECT rendering.
  await setSlider(page, 'tp-m', '256')
  await page.locator('#tp-extract').click()
  await expect(page.locator('#tp-m-out')).toHaveText('256')
  await expect(page.locator('#tp-verdicts .verdict-box.alarm')).toHaveCount(1)
  await scanAt('extracted at m = 256 — overdraft past the model min-entropy')

  // The thin-margin middle branch, between the 2⁻³² and 2⁻¹⁰ policy lines.
  for (const m of ['176', '184', '192', '200', '208']) {
    await setSlider(page, 'tp-m', m)
    if ((await page.locator('#tp-verdicts .verdict-box.warn').count()) === 1) break
  }
  if ((await page.locator('#tp-verdicts .verdict-box.warn').count()) === 1) {
    await page.locator('#tp-extract').click()
    await scanAt('extracted at a thin-margin m — the warn branch of the policy verdict')
  }
  await setSlider(page, 'tp-m', '128')

  // ── Panel 5 — the health tests ───────────────────────────────────────────
  // Stick the detector: RCT and APT both fail, the alarm latches, and the
  // extractor upstairs refuses input.
  await page.locator('#ht-stick').click()
  await expect(page.locator('#src-stick')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#src-stick')).toHaveText('Un-stick detector B')
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await expect(page.locator('#tp-gate-note')).not.toBeEmpty()
  await expect(page.locator('#ht-verdicts .verdict-box.alarm')).toHaveCount(3)
  await scanAt('detector B stuck — RCT and APT failed, alarm latched, extractor blocked')

  // Recommissioning a DEAD source is refused — the one refusal message here.
  await page.locator('#ht-reset').click()
  await expect(page.locator('#ht-reset-note')).toHaveText(/Recommissioning refused/)
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await scanAt('recommission refused while the source is still dead')

  // Repair alone does not unlatch: the alarm is an operator-cleared state.
  await page.locator('#ht-unstick').click()
  await expect(page.locator('#src-stick')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#tp-extract')).toBeDisabled()
  await scanAt('source repaired but the alarm still latched')

  await page.locator('#ht-reset').click()
  await expect(page.locator('#tp-extract')).toBeEnabled()
  await expect(page.locator('#ht-reset-note')).toBeEmpty()
  await expect(page.locator('#tp-gate-note')).toBeEmpty()
  await scanAt('recommissioned — alarm cleared and extraction re-enabled')

  // ── Every disclosure, opened through its own summary ──────────────────────
  for (let i = 0; i < 4; i += 1) {
    await openDisclosure(page, i)
    await scanAt(`disclosure ${i + 1} of 4 opened`)
  }
}
