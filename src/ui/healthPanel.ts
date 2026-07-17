import { blockMinEntropyRate } from '../entropy/blockentropy.ts'
import { APT_WINDOW } from '../entropy/healthtests.ts'
import { $, fmt, html } from './dom.ts'
import { BLOCK_LEN, recommission, setConfig, subscribe } from './state.ts'

export function initHealthPanel(root: HTMLElement): void {
  html(
    root,
    `
    <p class="kicker">5 · The tripwires</p>
    <h2 id="health-h">SP 800-90B health tests — because a dead source outputs a beautiful constant</h2>
    <p class="lede">
      A real entropy source runs these two tests continuously, forever — and this panel now works
      the same way: monitor state carries across every emission, an alarm <strong>latches</strong>,
      and while it is latched the extractor upstairs refuses input, exactly like a real source
      boundary. The tests illustrate the Repetition Count Test and Adaptive Proportion Test defined
      by SP 800-90B §4.4. They are tripwires for catastrophic failure, not entropy estimators.
    </p>
    <div class="stat-grid" id="ht-claim"></div>
    <div class="verdict-pair" role="status" aria-live="polite" id="ht-verdicts"></div>
    <div class="controls">
      <button id="ht-stick">Break it: stick detector B</button>
      <button id="ht-unstick" class="secondary">Repair the source</button>
      <button id="ht-reset" class="secondary">Reset alarm &amp; recommission at current model</button>
    </div>
    <p class="note" id="ht-reset-note"></p>
    <details>
      <summary>Claims, cutoffs, and what these tests do and do not promise</summary>
      <div>
        <p class="note">
          The cutoffs are functions of the <em>claimed</em> per-sample min-entropy H, fixed when the
          device is commissioned: RCT fires at a run of C = 1 + ⌈20/H⌉ identical samples, and APT
          fires when the first sample of a ${APT_WINDOW}-sample window recurs
          1 + critbinom(${APT_WINDOW}, 2⁻ᴴ, 1−2⁻²⁰) times, so an ideal source AT the claim
          false-alarms about once per 2²⁰ evaluations. Claiming more entropy than the device has
          makes alarms common — which is a feature: the original version of this lab claimed
          H = 1 for a 53/47 device, and its APT would have false-alarmed roughly a thousand times
          too often. Changing cutoffs is a commissioning action performed by an operator; a
          deployed source never relaxes its own claim after degrading.
        </p>
        <p class="note">
          Neither test certifies entropy: a stream can pass both while being 100% predictable to
          its manufacturer (a keyed PRNG passes every output-facing test there is). Passing means
          “not obviously dead,” never “random.” The extraction budget comes from the model bound
          in panels 2 and 4 — the tests only guard against the source dying later.
        </p>
      </div>
    </details>
  `,
  )

  $('#ht-stick', root).addEventListener('click', () => setConfig({ stuck: 1 }))
  $('#ht-unstick', root).addEventListener('click', () => setConfig({ stuck: null }))
  $('#ht-reset', root).addEventListener('click', () => {
    const ok = recommission()
    $('#ht-reset-note', root).textContent = ok
      ? ''
      : 'Recommissioning refused: the configured model carries (almost) no entropy. Repair the source first — you cannot paper over a dead device by re-declaring it.'
  })

  subscribe(({ raw, cfg, health }) => {
    const { rct, apt, claimedH, latched } = health
    const bound = blockMinEntropyRate(BLOCK_LEN, cfg)
    const claimValid = claimedH <= bound + 1e-9

    $('#ht-claim', root).innerHTML = `
      <div class="stat"><span class="label">Claimed H (commissioned)</span>
        <span class="value">${fmt(claimedH, 3)} bit/sample</span>
        <span class="note">cutoffs derive from this claim</span></div>
      <div class="stat"><span class="label">Model bound right now</span>
        <span class="value">${fmt(bound, 3)} bit/sample</span>
        <span class="note">${
          claimValid
            ? '✓ claim ≤ bound — claim is honest'
            : '⚠ source degraded below its claim — recommission or repair'
        }</span></div>
      <div class="stat"><span class="label">RCT cutoff</span>
        <span class="value">C = ${rct.cutoff}</span>
        <span class="note">1 + ⌈20 / ${fmt(claimedH, 3)}⌉</span></div>
      <div class="stat"><span class="label">APT window / cutoff</span>
        <span class="value">${APT_WINDOW} / ${apt.cutoff}</span>
        <span class="note">samples monitored: ${rct.samplesSeen.toLocaleString('en-US')}</span></div>
    `

    const rctFail = rct.alarmed
    const aptFail = apt.alarmed
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
        <p class="vb-title">Repetition Count Test (continuous)</p>
        <p class="vb-main">${
          rctFail
            ? `✕ FAILED at lifetime sample ${(rct.failedAt ?? 0) + 1} — run hit ${rct.cutoff}`
            : `✓ PASS — longest run ${rct.maxRun} < ${rct.cutoff}`
        }</p>
        <p class="vb-note">Run state survives emission boundaries; the alarm latches.</p>
      </div>
      <div class="verdict-box ${aptFail ? 'alarm' : 'ok'}">
        <p class="vb-title">Adaptive Proportion Test (continuous)</p>
        <p class="vb-main">${
          aptFail
            ? `✕ FAILED in lifetime window ${(apt.failedWindow ?? 0) + 1} — count hit ${apt.cutoff}`
            : `✓ PASS — max count ${apt.maxCount} < ${apt.cutoff} (${apt.windowsCompleted} windows)`
        }</p>
        <p class="vb-note">Window state survives emission boundaries; the alarm latches.</p>
      </div>
      ${
        latched
          ? `<div class="verdict-box alarm">
              <p class="vb-title">Source boundary</p>
              <p class="vb-main">✕ ALARM LATCHED — extractor input blocked</p>
              <p class="vb-note">Bits still display for teaching, but panel 4 will not accept them.
              Repair the source, then “Reset alarm &amp; recommission” — an explicit operator
              action, exactly as in a real device.</p>
            </div>`
          : ''
      }
    `
  })
}
