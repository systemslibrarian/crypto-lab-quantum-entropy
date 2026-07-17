import { APT_WINDOW, aptCutoff, rctCutoff, runAPT, runRCT } from '../entropy/healthtests.ts'
import { $, html } from './dom.ts'
import { setConfig, subscribe } from './state.ts'

/** Health tests assume the source claims full entropy (H = 1 bit/bit). */
const H_CLAIMED = 1

export function initHealthPanel(root: HTMLElement): void {
  const rctC = rctCutoff(H_CLAIMED)
  const aptC = aptCutoff(H_CLAIMED)
  html(
    root,
    `
    <p class="kicker">5 · The tripwires</p>
    <h2 id="health-h">SP 800-90B health tests — because a dead source outputs a beautiful constant</h2>
    <p class="lede">
      A real QRNG runs these two tests continuously, forever. They are not entropy estimators —
      they are tripwires for catastrophic failure, tuned so a healthy full-entropy source
      false-alarms only once per 2²⁰ evaluations. Stick a detector and watch the Repetition Count
      Test fire within ${rctC} samples.
    </p>
    <div class="stat-grid">
      <div class="stat"><span class="label">Claimed min-entropy H</span>
        <span class="value">${H_CLAIMED} bit/bit</span>
        <span class="note">the cutoffs derive from this claim</span></div>
      <div class="stat"><span class="label">RCT cutoff</span>
        <span class="value">C = ${rctC}</span>
        <span class="note">1 + ⌈20 / H⌉</span></div>
      <div class="stat"><span class="label">APT window / cutoff</span>
        <span class="value">${APT_WINDOW} / ${aptC}</span>
        <span class="note">1 + critbinom(W, 2⁻ᴴ, 1−2⁻²⁰)</span></div>
    </div>
    <div class="verdict-pair" role="status" aria-live="polite" id="ht-verdicts"></div>
    <div class="controls">
      <button id="ht-stick">Break it: stick detector B</button>
      <button id="ht-unstick" class="secondary">Repair the source</button>
    </div>
    <details>
      <summary>What these tests do and do not promise</summary>
      <div>
        <p class="note">
          The Repetition Count Test fires when one value repeats ${rctC} times in a row — a
          full-entropy source does that with probability 2⁻²⁰. The Adaptive Proportion Test counts
          how often the first sample of each ${APT_WINDOW}-sample window recurs inside that window
          and fires at ${aptC} — catching a source that degrades badly without flatlining. Neither
          test certifies entropy: a stream can pass both while being 100% predictable to its
          manufacturer (a keyed PRNG passes every output-facing test there is). Passing means “not
          obviously dead,” never “random.” Entropy is established by the estimation and the
          extraction accounting above — the tests only guard against the source dying later.
        </p>
      </div>
    </details>
  `,
  )

  $('#ht-stick', root).addEventListener('click', () => setConfig({ stuck: 1 }))
  $('#ht-unstick', root).addEventListener('click', () => setConfig({ stuck: null }))

  subscribe(({ raw, cfg }) => {
    const rct = runRCT(raw, rctC)
    const apt = runAPT(raw, aptC)
    const rctFail = rct.failedAt !== null
    const aptFail = apt.failedWindow !== null

    $('#ht-verdicts', root).innerHTML = `
      <div class="verdict-box neutral">
        <p class="vb-title">Output flow (what a consumer sees)</p>
        <p class="vb-main">${raw.length.toLocaleString('en-US')} bits delivered ✓</p>
        <p class="vb-note">${
          cfg.stuck !== null
            ? 'The stuck source still “works” — bits keep flowing. Flow is not health.'
            : 'Bits are flowing normally.'
        }</p>
      </div>
      <div class="verdict-box ${rctFail ? 'alarm' : 'ok'}">
        <p class="vb-title">Repetition Count Test</p>
        <p class="vb-main">${
          rctFail
            ? `✕ FAILED at sample ${(rct.failedAt ?? 0) + 1} — run hit ${rctC}`
            : `✓ PASS — longest run ${rct.maxRun} < ${rctC}`
        }</p>
        <p class="vb-note">${
          rctFail
            ? 'A real device would raise an alarm and stop serving bits here.'
            : 'No catastrophic repetition detected.'
        }</p>
      </div>
      <div class="verdict-box ${aptFail ? 'alarm' : 'ok'}">
        <p class="vb-title">Adaptive Proportion Test</p>
        <p class="vb-main">${
          aptFail
            ? `✕ FAILED in window ${(apt.failedWindow ?? 0) + 1} — count ${apt.maxCount} ≥ ${aptC}`
            : `✓ PASS — max count ${apt.maxCount} < ${aptC} in ${apt.windowsTested} windows`
        }</p>
        <p class="vb-note">${
          aptFail
            ? 'The source is emitting one value far too often for its entropy claim.'
            : `Windows of ${APT_WINDOW} samples, reference = first sample of each window.`
        }</p>
      </div>
    `
  })
}
