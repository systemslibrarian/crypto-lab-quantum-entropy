import { expect, test, type Page } from '@playwright/test'

/**
 * Functional regression gate for the Quantum Entropy demo.
 *
 * The a11y spec proves the page is reachable and scannable; this one proves the
 * page is *right*. The source is a CSPRNG-driven model, so nothing here pins a
 * sampled value: every assertion is either an INVARIANT that must hold on every
 * run (parts summing to the whole, a percentage matching its own numerator and
 * denominator, a verdict matching the number printed beside it) or a value
 * recomputed from what the page itself rendered — the detector counts drive the
 * expected Shannon/min-entropy figures, the commissioned claim drives the
 * expected SP 800-90B cutoffs, and the configured model drives k and ε. The
 * model bound k depends only on the two sliders, never on the sample, so the
 * entropy budget IS deterministic and is pinned exactly.
 *
 * What is pinned, panel by panel:
 *
 *   1. Source — A clicks + B clicks = photons emitted, the measured bias is
 *      that quotient, the beam-splitter diagram's two percentages sum to 100%,
 *      and the raw-stream region accounts for all 4,096 bits.
 *   2. Headline — the "Shannon says N% random" headline, both entropy stats,
 *      the attacker's one-guess probability and the gap are all recomputed from
 *      the bias the page measured, so a wrong verdict cannot hide behind a
 *      hardcoded string (this headline was hardcoded at 99.7% once already).
 *   3. Von Neumann — kept bits + discarded pairs = pairs read, throughput is
 *      that quotient, the step animation's tally matches its own strip, and the
 *      README's headline lesson (bias check PASSES while the dependence verdict
 *      REJECTS on a streaky source) is driven and asserted.
 *   4. Toeplitz — k is recomputed by an independent max-product DP over the
 *      configured model, ε = ½·√(2^(m−k)) is recomputed from it, the accept /
 *      warn / reject policy lines are checked on both sides of both thresholds,
 *      the overdraft is named, and every output bit is accounted for.
 *   5. Health — cutoffs are recomputed from the commissioned claim (RCT
 *      1 + ⌈20/H⌉, APT 1 + critbinom(1024, 2^−H, 1−2^−20)), monitor state is
 *      shown to persist across emissions, and the latch is proven to block
 *      extraction until BOTH repair and recommission happen.
 *
 * Every failure path the app has is driven: stuck detector, correlated source,
 * over-drawn entropy budget, refused recommissioning of a dead source, and the
 * latched health alarm — each asserted to reach the failure state AND to name
 * its cause on screen. Stale state is checked after every input change.
 */

const STREAM_LEN = 4096
const BLOCK_LEN = 256
const APT_WINDOW = 1024

// ---------------------------------------------------------------------------
// Independent re-implementations of the arithmetic the page claims to run.
// ---------------------------------------------------------------------------

/** H(p) = −p·log₂p − (1−p)·log₂(1−p) */
function shannonEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
}

/** H∞(p) = −log₂ max(p, 1−p) */
function minEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -Math.log2(Math.max(p, 1 - p))
}

/**
 * −log₂ P(most likely n-bit path) of the repeat-or-fresh Markov model: the
 * extraction budget k. Depends only on the slider settings, so it is exact and
 * reproducible even though the emitted sample is not.
 */
function blockMinEntropy(n: number, pOne: number, persistence: number, stuck: boolean): number {
  if (stuck) return 0
  if (pOne === 0 || pOne === 1) return 0
  if (persistence === 1) return -Math.log2(Math.max(pOne, 1 - pOne))
  const c = persistence
  const p = pOne
  const t = [
    [Math.log2(c + (1 - c) * (1 - p)), Math.log2((1 - c) * p)],
    [Math.log2((1 - c) * (1 - p)), Math.log2(c + (1 - c) * p)],
  ]
  let l0 = Math.log2(1 - p)
  let l1 = Math.log2(p)
  for (let i = 1; i < n; i++) {
    const n0 = Math.max(l0 + t[0][0], l1 + t[1][0])
    const n1 = Math.max(l0 + t[0][1], l1 + t[1][1])
    l0 = n0
    l1 = n1
  }
  return -Math.max(l0, l1)
}

/** ε(k, m) = ½·√(2^(m−k)) */
const lhlEpsilon = (k: number, m: number) => 0.5 * Math.pow(2, (m - k) / 2)

/** SP 800-90B §4.4.1 repetition-count cutoff. */
const rctCutoff = (h: number) => 1 + Math.ceil(20 / h)

/** Smallest x with P[Binom(n,p) ≤ x] ≥ target, summed in log space. */
function critBinom(n: number, p: number, target: number): number {
  const logFact = new Float64Array(n + 1)
  for (let i = 2; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i)
  const logP = Math.log(p)
  const logQ = Math.log1p(-p)
  let cdf = 0
  for (let x = 0; x <= n; x++) {
    cdf += Math.exp(logFact[n] - logFact[x] - logFact[n - x] + x * logP + (n - x) * logQ)
    if (cdf >= target) return x
  }
  return n
}

/** SP 800-90B §4.4.2 adaptive-proportion cutoff at α = 2⁻²⁰. */
const aptCutoff = (h: number) =>
  1 + critBinom(APT_WINDOW, Math.pow(2, -h), 1 - Math.pow(2, -20))

// The page's own formatters (src/ui/dom.ts), so expectations are strings the
// page could actually have produced.
const fmt = (x: number, digits = 4) => x.toFixed(digits)
const pct = (x: number, digits = 1) => `${(100 * x).toFixed(digits)}%`
const sci = (x: number) => (x === 0 ? '0' : x >= 0.001 ? x.toPrecision(3) : x.toExponential(1))

// ---------------------------------------------------------------------------
// DOM readers
// ---------------------------------------------------------------------------

interface Stat {
  value: string
  note: string
}

/** Every `.stat` in a grid, keyed by its label text. */
async function statGrid(page: Page, grid: string): Promise<Record<string, Stat>> {
  return page.evaluate((sel) => {
    const out: Record<string, { value: string; note: string }> = {}
    for (const s of Array.from(document.querySelectorAll(`${sel} .stat`))) {
      const label = (s.querySelector('.label')?.textContent ?? '').replace(/\s+/g, ' ').trim()
      out[label] = {
        value: (s.querySelector('.value')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        note: (s.querySelector('.note')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      }
    }
    return out
  }, grid)
}

/** Look a stat up by an unambiguous fragment of its label. */
function pick(all: Record<string, Stat>, fragment: string): Stat {
  const key = Object.keys(all).find((k) => k.includes(fragment))
  expect(key, `no stat labelled like "${fragment}" in ${JSON.stringify(Object.keys(all))}`)
    .toBeTruthy()
  return all[key as string]
}

interface Verdict {
  cls: string
  title: string
  main: string
  note: string
}

async function verdicts(page: Page, sel: string): Promise<Verdict[]> {
  return page.evaluate((s) => {
    return Array.from(document.querySelectorAll(`${s} .verdict-box`)).map((b) => ({
      cls: b.className,
      title: (b.querySelector('.vb-title')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      main: (b.querySelector('.vb-main')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      note: (b.querySelector('.vb-note')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
  }, sel)
}

/**
 * A healthy 53/47 device trips the RCT roughly once in 300 emissions all by
 * itself (a 23-long run is rare, not impossible), and the alarm latches. Tests
 * that assert a PASSING health panel re-draw and recommission until they have
 * an un-alarmed lifetime, so a genuine rare event never reads as a regression.
 */
async function settleHealthy(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const boxes = await verdicts(page, '#ht-verdicts')
    if (boxes.length === 3 && boxes[1].main.startsWith('✓') && boxes[2].main.startsWith('✓')) return
    await page.locator('#src-generate').click()
    await page.locator('#ht-reset').click()
  }
  throw new Error('health tests kept alarming on a healthy source')
}

async function text(page: Page, sel: string): Promise<string> {
  return ((await page.locator(sel).textContent()) ?? '').replace(/\s+/g, ' ').trim()
}

/** "4,096" -> 4096, "-21.5" -> -21.5, "51.4%" -> 51.4 */
function num(s: string): number {
  const m = /-?[\d,]+(?:\.\d+)?/.exec(s)
  expect(m, `no number in "${s}"`).toBeTruthy()
  return Number((m as RegExpMatchArray)[0].replace(/,/g, ''))
}

/** The exact bias the page measured, from counts it printed (no rounding loss). */
async function measuredBias(page: Page): Promise<{ p: number; ones: number; total: number }> {
  const src = await statGrid(page, '#src-stats')
  const total = num(pick(src, 'Photons emitted').value)
  const zeros = num(pick(src, 'Detector A clicks').value)
  const ones = num(pick(src, 'Detector B clicks').value)
  expect(zeros + ones).toBe(total)
  return { p: ones / total, ones, total }
}

/** k for the model the sliders currently describe. */
async function modelK(page: Page, stuck = false): Promise<number> {
  const pOne = Number(await page.locator('#src-bias').inputValue()) / 100
  const persistence = Number(await page.locator('#src-corr').inputValue()) / 100
  return blockMinEntropy(BLOCK_LEN, pOne, persistence, stuck)
}

async function setBias(page: Page, percent: number): Promise<void> {
  await page.locator('#src-bias').fill(String(percent))
  await page.locator('#src-bias').dispatchEvent('change')
}

// Uncaught page exceptions fail the test that provoked them. Reset per test; a
// worker only ever runs one test at a time, so this stays test-scoped.
let pageErrors: string[] = []

test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.goto('.')
  await expect(page.locator('#src-generate')).toBeVisible()
  // The initial emission has landed once the source stats are populated.
  await expect(page.locator('#src-stats .stat').first()).toBeVisible()
})

test.afterEach(() => {
  expect(pageErrors).toEqual([])
})

// ---------------------------------------------------------------------------
// 1 · The source
// ---------------------------------------------------------------------------

test('the detector counts partition the emitted photons, and the diagram agrees', async ({
  page,
}) => {
  const src = await statGrid(page, '#src-stats')
  const total = num(pick(src, 'Photons emitted').value)
  const zeros = num(pick(src, 'Detector A clicks').value)
  const ones = num(pick(src, 'Detector B clicks').value)

  // README: "Emits 4,096-bit raw streams." Every photon landed on exactly one
  // detector — the two counts are a partition, not two independent tallies.
  expect(total).toBe(STREAM_LEN)
  expect(zeros + ones).toBe(total)

  // The headline bias is that partition, not a separate number.
  expect(pick(src, 'Measured bias').value).toBe(pct(ones / total))
  expect(pick(src, 'Measured bias').note).toBe(
    `set point ${pct(Number(await page.locator('#src-bias').inputValue()) / 100, 0)}`,
  )

  // The two beam-splitter percentages are complementary and label the same split.
  const a = num(await text(page, '#src-diag-a'))
  const b = num(await text(page, '#src-diag-b'))
  expect(a + b).toBeCloseTo(100, 1)
  expect(await text(page, '#src-diag-b')).toBe(pct(ones / total))

  // The raw-stream region accounts for all 4,096 bits: 1,024 rendered plus a
  // count of the rest.
  const stream = await text(page, '#src-stream')
  const [shown, tail] = stream.split('…')
  expect(shown.replace(/\s/g, '')).toMatch(/^[01]{1024}$/)
  expect(1024 + num(tail)).toBe(total)
})

test('re-emitting redraws the stream and every panel follows it', async ({ page }) => {
  const before = await measuredBias(page)
  const beforeStream = await text(page, '#src-stream')

  await page.locator('#src-generate').click()

  const after = await measuredBias(page)
  expect(after.total).toBe(before.total)
  // A fresh 4,096-bit draw: the odds of an identical prefix are astronomical.
  expect(await text(page, '#src-stream')).not.toBe(beforeStream)

  // Panel 1 and panel 3 measure the SAME stream, so their bias figures agree.
  const vn = await statGrid(page, '#vn-stats')
  expect(pick(vn, 'Input bias').value).toBe(pct(after.p))
})

// ---------------------------------------------------------------------------
// 2 · Shannon vs min-entropy
// ---------------------------------------------------------------------------

test('both entropy numbers are recomputed from the bias the page measured', async ({ page }) => {
  const { p } = await measuredBias(page)
  const hSh = shannonEntropy(p)
  const hMin = minEntropy(p)

  const ent = await statGrid(page, '#ent-stats')
  expect(pick(ent, 'Measured bias').value).toBe(pct(p))
  expect(pick(ent, 'Shannon H').value).toBe(`${fmt(hSh)} bits/bit`)
  expect(pick(ent, 'Min-entropy H').value).toBe(`${fmt(hMin)} bits/bit`)

  // "= 2^−H∞ per bit": the attacker's one-guess probability is the max-likely
  // outcome's probability, which is what min-entropy is the log of.
  expect(pick(ent, 'single guess').value).toBe(pct(Math.max(p, 1 - p)))
  expect(Math.pow(2, -hMin)).toBeCloseTo(Math.max(p, 1 - p), 12)

  // The whole point of the panel: the marketing number is never smaller.
  expect(hSh).toBeGreaterThanOrEqual(hMin)

  // The headline and the "advertised" box quote the SAME live Shannon figure at
  // two precisions — a hardcoded 99.7% here was a real bug once.
  expect(await text(page, '#ent-headline-shannon')).toBe(pct(hSh))
  expect(await text(page, '#entropy-h')).toContain(pct(hSh))
  const boxes = await verdicts(page, '#ent-verdicts')
  expect(boxes[0].main).toBe(`“${pct(hSh, 2)} random!”`)

  // The chargeable box states the gap it is warning about, and it is the real gap.
  expect(boxes[1].main).toContain(fmt(hMin))
  expect(boxes[1].note).toContain(`Gap to Shannon: ${fmt(hSh - hMin)} bits/bit`)
})

test('the headline tracks the live measurement after the bias changes', async ({ page }) => {
  const first = await text(page, '#ent-headline-shannon')
  const firstK = num(pick(await statGrid(page, '#ent-stats'), 'Naive').value.replace('2^', ''))

  await setBias(page, 70)

  const { p } = await measuredBias(page)
  expect(p).toBeGreaterThan(0.6) // the new set point really took effect
  const hSh = shannonEntropy(p)

  // No stale verdict: the headline, the H2 around it and the advertised box all
  // moved to the new measurement.
  expect(await text(page, '#ent-headline-shannon')).toBe(pct(hSh))
  expect(await text(page, '#ent-headline-shannon')).not.toBe(first)
  const boxes = await verdicts(page, '#ent-verdicts')
  expect(boxes[0].main).toBe(`“${pct(hSh, 2)} random!”`)

  // ... and so did the model's attacker-work figure, downward.
  const k = await modelK(page)
  expect(pick(await statGrid(page, '#ent-stats'), 'Naive').value).toBe(`2^${fmt(k, 1)}`)
  expect(k).toBeLessThan(firstK)
})

test('the chargeable figure is the model bound, and panels 2 and 4 quote the same k', async ({
  page,
}) => {
  const k = await modelK(page)
  const ent = await statGrid(page, '#ent-stats')
  const tp = await statGrid(page, '#tp-stats')

  // Panel 2's attacker-work figure and panel 4's extraction budget are the same
  // quantity — the model's most-likely-path bound — so they must agree exactly.
  expect(pick(ent, 'Naive').value).toBe(`2^${fmt(k, 1)}`)
  expect(pick(tp, 'Model min-entropy in').value).toBe(`${fmt(k, 1)} bits`)
  expect(k).toBeLessThan(BLOCK_LEN)

  // The Shannon comparison in the same note is the sample figure times 256 —
  // the "20+ bits of work" overstatement the README is about.
  const { p } = await measuredBias(page)
  expect(pick(ent, 'Naive').note).toContain(`2^${fmt(BLOCK_LEN * shannonEntropy(p), 1)}`)
  expect(BLOCK_LEN * shannonEntropy(p)).toBeGreaterThan(k)
})

// ---------------------------------------------------------------------------
// 3 · Von Neumann debiasing
// ---------------------------------------------------------------------------

test('von Neumann conserves pairs: bits kept + discarded pairs = pairs read', async ({ page }) => {
  const { p, total } = await measuredBias(page)
  const vn = await statGrid(page, '#vn-stats')

  const [kept, discarded] = pick(vn, 'Bits kept')
    .value.split('/')
    .map((s) => num(s))

  // Every pair either emitted exactly one bit or was discarded. Nothing else.
  expect(kept + discarded).toBe(total / 2)

  // Throughput is that quotient, and it sits near the theoretical p(1−p).
  expect(pick(vn, 'Throughput').value).toBe(pct(kept / total))
  expect(pick(vn, 'Throughput').note).toBe(`expected ≈ p(1−p) = ${pct(p * (1 - p))}`)
  expect(kept / total).toBeGreaterThan(0)
  expect(kept / total).toBeLessThan(0.5)

  // The debiaser's promise, on an independent source: the output bias lands
  // near 50% whatever the input bias was.
  const outBias = num(pick(vn, 'Output bias').value) / 100
  expect(Math.abs(outBias - 0.5)).toBeLessThan(Math.abs(p - 0.5) + 0.03)

  // The bias verdict is a statement about the number printed beside it — it
  // passes exactly when that number is within 3 points of 50%, and says
  // "small sample" rather than PASS when it is not.
  const boxes = await verdicts(page, '#vn-verdicts')
  const within = Math.abs(outBias - 0.5) < 0.03
  expect(boxes[0].main).toBe(
    within ? `✓ PASS — ${pct(outBias)} ones` : `⚠ ${pct(outBias)} ones (small sample)`,
  )
  expect(boxes[0].cls).toContain(within ? 'ok' : 'warn')
})

test('the step animation and its running tally describe the same pairs', async ({ page }) => {
  const strip = page.locator('#vn-strip [role="listitem"]')
  await expect(strip).toHaveCount(24)
  expect(await text(page, '#vn-anim-note')).toContain('stepped: 0 → kept “”, discarded 0')

  const STEPS = 7
  for (let i = 0; i < STEPS; i++) await page.locator('#vn-step').click()

  const items = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#vn-strip [role="listitem"]')).map((e) => ({
      cls: e.className,
      txt: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  )

  // Each stepped cell applies von Neumann's 1951 rule to its own two bits, and
  // the cells after the cursor have not been decided yet.
  let emitted = ''
  let dropped = 0
  for (let i = 0; i < items.length; i++) {
    const m = /^([01])([01])(?: → (.+))?$/.exec(items[i].txt)
    expect(m, `unparsable strip cell ${i}: "${items[i].txt}"`).toBeTruthy()
    const [, b1, b2, result] = m as RegExpMatchArray
    if (i < STEPS) {
      if (b1 === b2) {
        expect(items[i].cls).toContain('dropped')
        expect(result).toBe('✕')
        dropped++
      } else {
        expect(items[i].cls).toContain('emitted')
        expect(result).toBe(b1 === '0' ? '0' : '1')
        emitted += result
      }
    } else {
      expect(result).toBeUndefined()
      expect(items[i].cls).toContain(i === STEPS ? 'current' : 'pending')
    }
  }

  // The tally under the strip is that same walk, and its parts sum to the steps.
  expect(await text(page, '#vn-anim-note')).toContain(
    `stepped: ${STEPS} → kept “${emitted}”, discarded ${dropped}`,
  )
  expect(emitted.length + dropped).toBe(STEPS)

  // Re-emitting rewinds the animation instead of leaving a tally over new pairs.
  await page.locator('#src-generate').click()
  expect(await text(page, '#vn-anim-note')).toContain('stepped: 0 → kept “”, discarded 0')
  await expect(page.locator('#vn-strip .emitted')).toHaveCount(0)
  await expect(page.locator('#vn-strip .dropped')).toHaveCount(0)
})

test('a streaky source passes the bias check while the dependence verdict rejects', async ({
  page,
}) => {
  await page.locator('#vn-break').click()
  // Regression: this button sets cfg.persistence, and panel 1's slider is the
  // control for exactly that value — but the slider tracked only its own
  // events, so it sat at "P(repeat last click) = 0%" while every other panel
  // reported an 80%-sticky source. A control may not contradict its own model.
  expect(await page.locator('#src-corr').inputValue()).toBe('80')
  expect(await text(page, '#src-corr-out')).toBe('80%')

  // README, exhibit 3: "the bias check still passes while the security verdict
  // rejects". The debiased stream is only ~200 bits, so on a minority of draws
  // its own frequency check reads "small sample" — re-emit until the promised
  // pair of verdicts co-occurs. Failing every attempt would mean the lesson
  // itself stopped working.
  let boxes = await verdicts(page, '#vn-verdicts')
  for (let attempt = 0; attempt < 12; attempt++) {
    boxes = await verdicts(page, '#vn-verdicts')
    if (/PASS/.test(boxes[0].main) && /dependence detected/.test(boxes[1].main)) break
    await page.locator('#src-generate').click()
  }

  expect(boxes[0].main).toMatch(/^✓ PASS — /)
  expect(boxes[0].cls).toContain('ok')
  expect(boxes[1].main).toMatch(/^✕ dependence detected — predictor guesses [\d.]+% of output bits$/)
  expect(boxes[1].cls).toContain('alarm')
  // The UI names the cause rather than just colouring a box red.
  expect(boxes[1].note).toContain('von Neumann fixes bias, not correlation')
  // The verdict's own number clears the threshold it claims to have crossed.
  expect(num(boxes[1].main)).toBeGreaterThan(55)

  // The raw stream is where the damage is: the first-order predictor reads far
  // above chance there, and throughput has collapsed well under p(1−p).
  const vn = await statGrid(page, '#vn-stats')
  const tp = await statGrid(page, '#tp-stats')
  expect(num(/predictor ([\d.]+)%/.exec(pick(tp, 'Observed sample').note)![1])).toBeGreaterThan(80)
  const expected = num(/= ([\d.]+)%/.exec(pick(vn, 'Throughput').note)![1])
  expect(num(pick(vn, 'Throughput').value)).toBeLessThan(expected)

  // Restoring independence clears the alarm — no stale REJECT over a fixed source.
  await page.locator('#vn-fix').click()
  expect(await page.locator('#src-corr').inputValue()).toBe('0')
  expect(await text(page, '#src-corr-out')).toBe('0%')
  const fixed = await verdicts(page, '#vn-verdicts')
  expect(fixed[1].main).toMatch(/^✓ no first-order dependence detected/)
  expect(fixed[1].cls).not.toContain('alarm')
})

// ---------------------------------------------------------------------------
// 4 · Toeplitz extraction
// ---------------------------------------------------------------------------

test('the entropy budget, its bar and the LHL receipt are one consistent ledger', async ({
  page,
}) => {
  const k = await modelK(page)
  for (const m of [8, 128, 200]) {
    await page.locator('#tp-m').fill(String(m))
    const tp = await statGrid(page, '#tp-stats')

    expect(await text(page, '#tp-m-out')).toBe(String(m))
    expect(pick(tp, 'Bits demanded').value).toBe(String(m))
    expect(pick(tp, 'Model min-entropy in').value).toBe(`${fmt(k, 1)} bits`)
    // The margin is the subtraction it claims to be, and ε is that margin's
    // exact LHL bound — not an independently drifting number.
    expect(pick(tp, 'Security margin').value).toBe(`${fmt(k - m, 1)} bits`)
    expect(pick(tp, 'Distance from uniform').value).toBe(sci(lhlEpsilon(k, m)))

    // The budget bar's accessible description quotes the same three numbers.
    const label = (await page.locator('#tp-budget').getAttribute('aria-label')) ?? ''
    expect(label).toContain(`of ${BLOCK_LEN} raw bits`)
    expect(label).toContain(`k = ${k.toFixed(1)} bits`)
    expect(label).toContain(`m = ${m} bits`)
    expect(label).toContain(`security margin of ${(k - m).toFixed(1)} bits`)
  }
})

test('the accept / warn / reject policy lines land on the right side of ε', async ({ page }) => {
  const k = await modelK(page)
  // Straddles both teaching thresholds (2⁻³² and 2⁻¹⁰) and the vacuous point.
  for (const m of [160, 168, 200, 216, 224, 256]) {
    await page.locator('#tp-m').fill(String(m))
    const eps = lhlEpsilon(k, m)
    const box = (await verdicts(page, '#tp-verdicts'))[1]

    if (eps <= Math.pow(2, -32)) {
      expect(box.cls, `m=${m}`).toContain('ok')
      expect(box.main).toBe(`✓ ε ≤ ${sci(eps)} — below this lab’s 2⁻³² accept line`)
    } else if (eps <= Math.pow(2, -10)) {
      expect(box.cls, `m=${m}`).toContain('warn')
      expect(box.main).toBe(`⚠ ε ≤ ${sci(eps)} — thin margin under this lab’s policy`)
    } else {
      expect(box.cls, `m=${m}`).toContain('alarm')
      expect(box.main).toBe(
        eps >= 1
          ? '✕ REJECT — the bound is vacuous'
          : `✕ REJECT — ε ≤ ${sci(eps)} is far above the accept line`,
      )
      // The rejection names the two numbers that caused it.
      expect(box.note).toContain(`You demanded m = ${m} bits from k = ${fmt(k, 1)} bits`)
    }
  }
})

test('overdrawing the budget is refused, and the overdraft is named', async ({ page }) => {
  const k = await modelK(page)
  const m = BLOCK_LEN
  await page.locator('#tp-m').fill(String(m))

  const tp = await statGrid(page, '#tp-stats')
  expect(num(pick(tp, 'Security margin').value)).toBeLessThan(0)
  expect(pick(tp, 'Distance from uniform').value).toBe('≥ 1 (vacuous)')
  expect(lhlEpsilon(k, m)).toBeGreaterThanOrEqual(1)

  const label = (await page.locator('#tp-budget').getAttribute('aria-label')) ?? ''
  expect(label).toContain(`an overdraft of ${(m - k).toFixed(1)} bits past the available entropy`)

  // The extractor still runs — that is the lesson — but the verdict rejects.
  await page.locator('#tp-extract').click()
  const boxes = await verdicts(page, '#tp-verdicts')
  expect(boxes[0].main).toBe(`${m} bits output ✓`)
  expect(boxes[1].cls).toContain('alarm')
  expect(boxes[1].main).toBe('✕ REJECT — the bound is vacuous')
  expect(boxes[1].note).toContain('the accounting, not the appearance, is the verdict')
})

test('extraction emits exactly m bits and row 0 reproduces the first of them', async ({ page }) => {
  for (const m of [8, 128]) {
    await page.locator('#tp-m').fill(String(m))
    await page.locator('#tp-extract').click()

    // m bits of output, m+n−1 seed bits spent — the Toeplitz seed length.
    const out = await text(page, '#tp-output')
    const hex = /^hex: ([0-9a-f]+) /.exec(out)
    expect(hex, out).toBeTruthy()
    expect((hex as RegExpMatchArray)[1]).toHaveLength(m / 4)
    expect(out).toContain(
      `(${m} bits from ${BLOCK_LEN} raw bits; seed spent: ${m + BLOCK_LEN - 1} uniform bits)`,
    )

    // The worked row-0 example is arithmetic, not decoration: the parity of the
    // matched ones IS the first output bit, and it is the first hex nibble's
    // top bit.
    const row0 = await text(page, '#tp-row0')
    const walk = /→ (\d+) matched ones → parity (\d) = output bit (\d)\./.exec(row0)
    expect(walk, row0).toBeTruthy()
    const [, matched, parity, bit] = walk as RegExpMatchArray
    expect(Number(matched) % 2).toBe(Number(parity))
    expect(parity).toBe(bit)
    expect(parseInt((hex as RegExpMatchArray)[1][0], 16) >> 3).toBe(Number(bit))
    expect(row0).toContain(`Every one of the ${m} output bits`)

    // The matrix corner renders min(12, m) rows of 28 cells.
    await expect(page.locator('#tp-matrix rect')).toHaveCount(Math.min(12, m) * 28)
  }
})

test('a new stream retracts the previous extraction instead of leaving it standing', async ({
  page,
}) => {
  await page.locator('#tp-extract').click()
  expect(await text(page, '#tp-output')).toContain('hex: ')
  expect((await verdicts(page, '#tp-verdicts'))[0].main).toBe('128 bits output ✓')

  await page.locator('#src-generate').click()

  // The old output was computed from bits that no longer exist anywhere on the
  // page; nothing about it may survive.
  expect(await text(page, '#tp-output')).toBe('(stream changed — press “Draw fresh seed & extract”)')
  expect(await text(page, '#tp-row0')).toBe('')
  await expect(page.locator('#tp-matrix rect')).toHaveCount(0)
  const boxes = await verdicts(page, '#tp-verdicts')
  expect(boxes[0].main).toBe('—')
  expect(boxes[0].note).toContain('Not extracted yet')
})

// ---------------------------------------------------------------------------
// 5 · Continuous health tests
// ---------------------------------------------------------------------------

test('the health cutoffs are the commissioned claim run through the SP 800-90B formulas', async ({
  page,
}) => {
  await settleHealthy(page)
  const ht = await statGrid(page, '#ht-claim')
  const claimed = Number(pick(ht, 'Claimed H').value.replace(' bit/sample', ''))
  const bound = Number(pick(ht, 'Model bound').value.replace(' bit/sample', ''))

  // The claim is the model bound floored to three decimals — conservative by
  // construction, so it can never exceed what the model provides.
  const k = await modelK(page)
  expect(claimed).toBe(Math.floor((k / BLOCK_LEN) * 1000) / 1000)
  expect(bound).toBe(Number(fmt(k / BLOCK_LEN, 3)))
  expect(claimed).toBeLessThanOrEqual(bound)
  expect(pick(ht, 'Model bound').note).toContain('claim ≤ bound — claim is honest')

  // Both cutoffs derive from that claim, and the panel shows the RCT formula.
  expect(pick(ht, 'RCT cutoff').value).toBe(`C = ${rctCutoff(claimed)}`)
  expect(pick(ht, 'RCT cutoff').note).toBe(`1 + ⌈20 / ${fmt(claimed, 3)}⌉`)
  expect(pick(ht, 'APT window').value).toBe(`${APT_WINDOW} / ${aptCutoff(claimed)}`)

  // A healthy source passes both, and each verdict's numbers respect its cutoff.
  const boxes = await verdicts(page, '#ht-verdicts')
  expect(boxes).toHaveLength(3) // no "source boundary" box while unlatched
  const run = /longest run (\d+) < (\d+)/.exec(boxes[1].main)
  expect(run, boxes[1].main).toBeTruthy()
  expect(Number(run![1])).toBeLessThan(Number(run![2]))
  expect(Number(run![2])).toBe(rctCutoff(claimed))

  const apt = /max count (\d+) < (\d+) \((\d+) windows\)/.exec(boxes[2].main)
  expect(apt, boxes[2].main).toBeTruthy()
  expect(Number(apt![1])).toBeLessThan(Number(apt![2]))
  expect(Number(apt![2])).toBe(aptCutoff(claimed))
  // Windows completed is the sample count divided by the window width.
  const samples = num(pick(ht, 'APT window').note)
  expect(samples).toBe(STREAM_LEN)
  expect(Number(apt![3])).toBe(samples / APT_WINDOW)
  // A count of the window's own reference sample can never exceed the window.
  expect(Number(apt![1])).toBeGreaterThan(0)
  expect(Number(apt![1])).toBeLessThanOrEqual(APT_WINDOW)
})

test('monitor state accumulates across emissions rather than restarting', async ({ page }) => {
  const samplesNow = async () => num(pick(await statGrid(page, '#ht-claim'), 'APT window').note)
  const windowsNow = async () =>
    Number(/\((\d+) windows\)/.exec((await verdicts(page, '#ht-verdicts'))[2].main)![1])

  expect(await samplesNow()).toBe(STREAM_LEN)
  for (let i = 2; i <= 4; i++) {
    await page.locator('#src-generate').click()
    // README: "monitor state persists across emissions" — one continuous
    // lifetime, not one evaluation per button press.
    expect(await samplesNow()).toBe(i * STREAM_LEN)
    expect(await windowsNow()).toBe((i * STREAM_LEN) / APT_WINDOW)
  }
})

test('a stuck detector fails both tests, latches, and blocks the extractor', async ({ page }) => {
  const before = num(pick(await statGrid(page, '#ht-claim'), 'APT window').note)
  const claimed = Number(
    pick(await statGrid(page, '#ht-claim'), 'Claimed H').value.replace(' bit/sample', ''),
  )

  await page.locator('#ht-stick').click()

  // The source still delivers bits — "flow is not health" — but every count it
  // delivers is the same one.
  const src = await statGrid(page, '#src-stats')
  expect(num(pick(src, 'Detector A clicks').value)).toBe(0)
  expect(num(pick(src, 'Detector B clicks').value)).toBe(STREAM_LEN)
  expect(pick(src, 'Measured bias').value).toBe('100.0%')
  expect(pick(src, 'Measured bias').note).toContain('detector stuck')
  expect(await text(page, '#src-diag-b')).toBe('100% — stuck!')
  expect(await text(page, '#src-diag-a')).toBe('0% — silent')

  const boxes = await verdicts(page, '#ht-verdicts')
  expect(boxes[0].note).toContain('Flow is not health')

  // Both tests fire, each naming where in the source's LIFETIME it happened —
  // inside the emission just fed, not restarted at zero.
  const rct = /FAILED at lifetime sample (\d+) — run hit (\d+)/.exec(boxes[1].main)
  expect(rct, boxes[1].main).toBeTruthy()
  expect(Number(rct![2])).toBe(rctCutoff(claimed))
  expect(Number(rct![1])).toBeGreaterThan(before)
  expect(Number(rct![1])).toBeLessThanOrEqual(before + STREAM_LEN)
  expect(boxes[1].cls).toContain('alarm')

  const apt = /FAILED in lifetime window (\d+) — count hit (\d+)/.exec(boxes[2].main)
  expect(apt, boxes[2].main).toBeTruthy()
  expect(Number(apt![2])).toBe(aptCutoff(claimed))
  expect(Number(apt![1])).toBeLessThanOrEqual((before + STREAM_LEN) / APT_WINDOW)
  expect(boxes[2].cls).toContain('alarm')

  // The claim is now dishonest, and the panel says so.
  const ht = await statGrid(page, '#ht-claim')
  expect(pick(ht, 'Model bound').value).toBe('0.000 bit/sample')
  expect(pick(ht, 'Model bound').note).toContain('source degraded below its claim')

  // The boundary latches and the conditioner refuses input, with the reason.
  expect(boxes[3].main).toBe('✕ ALARM LATCHED — extractor input blocked')
  await expect(page.locator('#tp-extract')).toBeDisabled()
  expect(await text(page, '#tp-gate-note')).toContain('Blocked by the source boundary')
})

test('a dead source is charged zero entropy by every panel that reports on it', async ({ page }) => {
  await page.locator('#ht-stick').click()

  // Panel 2: no entropy at all, and the attacker needs one guess.
  const ent = await statGrid(page, '#ent-stats')
  expect(pick(ent, 'Shannon H').value).toBe('0.0000 bits/bit')
  expect(pick(ent, 'Min-entropy H').value).toBe('0.0000 bits/bit')
  expect(pick(ent, 'single guess').value).toBe('100.0%')
  expect(pick(ent, 'Naive').value).toBe('1 guess')

  // Regression: the chargeable verdict used to print "✓ 0.0000 bits/bit" here.
  // H − H∞ is zero at BOTH ends of the scale, so the gap test that means
  // "unbiased" at p = 0.5 also read clean for a detector welded to 1 — a ✓ in
  // the same panel that prints "1 guess" beside it.
  const entBox = (await verdicts(page, '#ent-verdicts'))[1]
  expect(entBox.main).not.toContain('✓')
  expect(entBox.main).toBe('⚠ dependence detected — model rate 0.0000 bits/bit')
  expect(entBox.note).toContain('predictor guesses 100.0% of this sample’s bits')

  // Panel 3: every pair is equal, so nothing survives the debiaser.
  const vn = await statGrid(page, '#vn-stats')
  expect(num(pick(vn, 'Bits kept').value.split('/')[0])).toBe(0)
  expect(num(pick(vn, 'Bits kept').value.split('/')[1])).toBe(STREAM_LEN / 2)
  expect(await text(page, '#vn-out')).toBe('(no pairs survived)')
  const vnBoxes = await verdicts(page, '#vn-verdicts')
  expect(vnBoxes[0].main).toBe('✕ no output — equal pairs only')
  expect(vnBoxes[1].main).toBe('✕ REJECT — source is dead')
  expect(vnBoxes[0].cls).toContain('alarm')
  expect(vnBoxes[1].cls).toContain('alarm')

  // Panel 4: the budget is empty, so any m at all is an overdraft.
  const tp = await statGrid(page, '#tp-stats')
  expect(pick(tp, 'Model min-entropy in').value).toBe('0.0 bits')
  expect(pick(tp, 'Distance from uniform').value).toBe('≥ 1 (vacuous)')
  expect((await verdicts(page, '#tp-verdicts'))[1].main).toBe('✕ REJECT — the bound is vacuous')
})

test('recommissioning a dead source is refused, and says why', async ({ page }) => {
  await page.locator('#ht-stick').click()
  const before = await statGrid(page, '#ht-claim')

  await page.locator('#ht-reset').click()

  expect(await text(page, '#ht-reset-note')).toBe(
    'Recommissioning refused: the configured model carries (almost) no entropy. Repair the source first — you cannot paper over a dead device by re-declaring it.',
  )
  // Nothing moved: the claim, the cutoffs and the latch all survive the refusal.
  const after = await statGrid(page, '#ht-claim')
  expect(pick(after, 'Claimed H').value).toBe(pick(before, 'Claimed H').value)
  expect(pick(after, 'RCT cutoff').value).toBe(pick(before, 'RCT cutoff').value)
  expect(pick(after, 'APT window').value).toBe(pick(before, 'APT window').value)
  expect((await verdicts(page, '#ht-verdicts'))[3].main).toBe(
    '✕ ALARM LATCHED — extractor input blocked',
  )
  await expect(page.locator('#tp-extract')).toBeDisabled()
})

test('the latch clears only after BOTH repair and recommissioning', async ({ page }) => {
  await page.locator('#ht-stick').click()
  await expect(page.locator('#tp-extract')).toBeDisabled()

  // Repair alone: the model is healthy again, but the alarm is latched, so the
  // boundary stays shut and the note still explains why.
  await page.locator('#ht-unstick').click()
  const repaired = await statGrid(page, '#ht-claim')
  expect(pick(repaired, 'Model bound').note).toContain('claim ≤ bound — claim is honest')
  expect((await verdicts(page, '#ht-verdicts'))[3].main).toBe(
    '✕ ALARM LATCHED — extractor input blocked',
  )
  await expect(page.locator('#tp-extract')).toBeDisabled()
  expect(await text(page, '#tp-gate-note')).toContain('Blocked by the source boundary')

  // The operator action: fresh monitors on the repaired source, no stale alarm
  // left behind, and the gate note retracted along with it.
  await page.locator('#ht-reset').click()
  await settleHealthy(page)
  const boxes = await verdicts(page, '#ht-verdicts')
  expect(boxes).toHaveLength(3)
  expect(boxes[1].main).toMatch(/^✓ PASS/)
  expect(boxes[2].main).toMatch(/^✓ PASS/)
  expect(await text(page, '#ht-reset-note')).toBe('')
  expect(await text(page, '#tp-gate-note')).toBe('')
  await expect(page.locator('#tp-extract')).toBeEnabled()
  // Recommissioning restarts the monitors' lifetime on the current stream.
  expect(num(pick(await statGrid(page, '#ht-claim'), 'APT window').note)).toBe(STREAM_LEN)

  await page.locator('#tp-extract').click()
  expect(await text(page, '#tp-output')).toContain('hex: ')
})

test('the source panel toggle and the health panel both drive the one stuck flag', async ({
  page,
}) => {
  const stick = page.locator('#src-stick')
  await expect(stick).toHaveAttribute('aria-pressed', 'false')
  await expect(stick).toHaveText('Stick detector B (failure)')

  // Regression: panel 5's "Break it" button sets the same cfg.stuck, but panel
  // 1's toggle used to track its own copy of it — leaving a button reading
  // "Stick detector B (failure)", aria-pressed="false", over an already-stuck
  // source, whose next click un-stuck the detector it offered to stick.
  await page.locator('#ht-stick').click()
  await expect(stick).toHaveAttribute('aria-pressed', 'true')
  await expect(stick).toHaveText('Un-stick detector B')

  // And it really is a toggle now: one click repairs the source.
  await stick.click()
  await expect(stick).toHaveAttribute('aria-pressed', 'false')
  await expect(stick).toHaveText('Stick detector B (failure)')
  const src = await statGrid(page, '#src-stats')
  expect(num(pick(src, 'Detector A clicks').value)).toBeGreaterThan(0)
  expect(pick(src, 'Measured bias').note).toContain('set point')

  // Sticking from panel 1 and repairing from panel 5 stay in sync too.
  await stick.click()
  await expect(stick).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#ht-unstick').click()
  await expect(stick).toHaveAttribute('aria-pressed', 'false')
  await expect(stick).toHaveText('Stick detector B (failure)')
})
