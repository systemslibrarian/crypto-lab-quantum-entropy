import { fractionOnes, markovPredictorAccuracy } from '../entropy/measures.ts'
import type { VNResult } from '../entropy/types.ts'
import { vonNeumann } from '../entropy/vonneumann.ts'
import { $, html, pct } from './dom.ts'
import { setConfig, state, subscribe } from './state.ts'

const SHOWN_PAIRS = 24

export function initVNPanel(root: HTMLElement): void {
  html(
    root,
    `
    <p class="kicker">3 · Headline — the classic fix, and its honest limit</p>
    <h2 id="vn-h">Von Neumann debiasing: perfect balance, brutal cost, wrong assumption</h2>
    <p class="lede">
      Von Neumann’s 1951 trick reads bit <em>pairs</em>: opposite pairs are kept (their order is
      the coin flip), equal pairs are thrown away. For independent bits this is exactly unbiased at
      any bias — but it keeps only 2p(1−p) of pairs, and it silently assumes independence. Step
      through real pairs from the stream above, then make the source streaky and see what the
      debiaser misses.
    </p>
    <div class="vn-rule" aria-label="Von Neumann rule">
      <span>01 → <strong>0</strong></span><span>10 → <strong>1</strong></span>
      <span>00 → ✕ discard</span><span>11 → ✕ discard</span>
    </div>
    <div class="controls">
      <button id="vn-step">Step one pair</button>
      <button id="vn-run" class="secondary">Run remaining pairs</button>
      <button id="vn-reset" class="secondary">Reset animation</button>
    </div>
    <div class="vn-strip" id="vn-strip" role="list" aria-label="First ${SHOWN_PAIRS} bit pairs and what the debiaser does with each"></div>
    <p class="note" id="vn-anim-note"></p>
    <h3 id="vn-out-h">Debiased output (full stream)</h3>
    <div class="bitscroll" tabindex="0" role="region" aria-labelledby="vn-out-h" id="vn-out"></div>
    <div class="stat-grid" id="vn-stats"></div>
    <div class="verdict-pair" role="status" aria-live="polite" id="vn-verdicts"></div>
    <div class="controls">
      <button id="vn-break">Break it: make the source streaky (80% correlation)</button>
      <button id="vn-fix" class="secondary">Restore independent source</button>
    </div>
    <details>
      <summary>Why the bias check passes even on a broken stream</summary>
      <div>
        <p class="note">
          For any stationary source, the pairs 01 and 10 occur equally often — so von Neumann’s
          output passes a frequency test <em>no matter how correlated the input is</em>. The damage
          goes where the bias meter cannot see: consecutive output bits stay mutually predictable,
          because each surviving pair leaks into the next through the source’s memory. The verdict
          box therefore measures the right thing — predictability — with a first-order predictor
          running on the actual output. Fixing correlation honestly requires a seeded extractor
          (next panel), not a cleverer pairing rule.
        </p>
      </div>
    </details>
  `,
  )

  let vn: VNResult = { output: new Uint8Array(0), steps: [], pairsRead: 0, discarded: 0 }
  let cursor = 0
  let timer: number | undefined

  const strip = $('#vn-strip', root)

  function renderStrip(): void {
    strip.innerHTML = ''
    const shown = vn.steps.slice(0, SHOWN_PAIRS)
    shown.forEach((s, i) => {
      const span = document.createElement('span')
      span.setAttribute('role', 'listitem')
      let cls = 'vn-pair'
      let result = ''
      if (i < cursor) {
        if (s.action === 'discard') {
          cls += ' dropped'
          result = ` <span class="arrow">→</span> <span class="res-drop">✕</span>`
        } else {
          cls += ' emitted'
          result = ` <span class="arrow">→</span> <span class="res-emit">${s.action === 'emit0' ? 0 : 1}</span>`
        }
      } else {
        cls += i === cursor ? ' current' : ' pending'
      }
      span.className = cls
      span.innerHTML = `${s.b1}${s.b2}${result}`
      strip.appendChild(span)
    })
    const emitted = vn.steps
      .slice(0, cursor)
      .filter((s) => s.action !== 'discard')
      .map((s) => (s.action === 'emit0' ? '0' : '1'))
      .join('')
    const dropped = vn.steps.slice(0, cursor).filter((s) => s.action === 'discard').length
    $('#vn-anim-note', root).textContent =
      `Animation shows the first ${SHOWN_PAIRS} pairs (stepped: ${Math.min(cursor, SHOWN_PAIRS)} → kept “${emitted.slice(0, 24)}”, discarded ${dropped}). All statistics below run over the full ${state.raw.length.toLocaleString('en-US')}-bit stream.`
  }

  function step(): void {
    if (cursor < Math.min(SHOWN_PAIRS, vn.steps.length)) {
      cursor++
      renderStrip()
    }
  }

  $('#vn-step', root).addEventListener('click', () => step())
  $('#vn-run', root).addEventListener('click', () => {
    window.clearInterval(timer)
    const end = Math.min(SHOWN_PAIRS, vn.steps.length)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cursor = end
      renderStrip()
      return
    }
    timer = window.setInterval(() => {
      step()
      if (cursor >= end) window.clearInterval(timer)
    }, 140)
  })
  $('#vn-reset', root).addEventListener('click', () => {
    window.clearInterval(timer)
    cursor = 0
    renderStrip()
  })
  $('#vn-break', root).addEventListener('click', () => setConfig({ persistence: 0.8 }))
  $('#vn-fix', root).addEventListener('click', () => setConfig({ persistence: 0 }))

  subscribe(({ raw, cfg }) => {
    window.clearInterval(timer)
    vn = vonNeumann(raw)
    cursor = 0
    renderStrip()

    const outBias = fractionOnes(vn.output)
    const rate = raw.length > 0 ? vn.output.length / raw.length : 0
    const p = fractionOnes(raw)
    const acc = markovPredictorAccuracy(vn.output)

    $('#vn-out', root).textContent =
      vn.output.length > 0 ? bitsPreview(vn.output) : '(no pairs survived)'
    $('#vn-stats', root).innerHTML = `
      <div class="stat"><span class="label">Input bias P(1)</span><span class="value">${pct(p)}</span></div>
      <div class="stat"><span class="label">Output bias P(1)</span><span class="value">${pct(outBias)}</span></div>
      <div class="stat"><span class="label">Throughput</span><span class="value">${pct(rate)}</span>
        <span class="note">expected ≈ p(1−p) = ${pct(p * (1 - p))}</span></div>
      <div class="stat"><span class="label">Bits kept / discarded pairs</span>
        <span class="value">${vn.output.length.toLocaleString('en-US')} / ${vn.discarded.toLocaleString('en-US')}</span></div>
    `

    const biasOK = vn.output.length > 100 && Math.abs(outBias - 0.5) < 0.03
    const predictable = vn.output.length > 100 && acc > 0.55
    const stuck = cfg.stuck !== null
    $('#vn-verdicts', root).innerHTML = `
      <div class="verdict-box ${stuck ? 'alarm' : biasOK ? 'ok' : 'warn'}">
        <p class="vb-title">What the debiaser promises — bias check</p>
        <p class="vb-main">${
          stuck
            ? '✕ no output — equal pairs only'
            : biasOK
              ? `✓ PASS — ${pct(outBias)} ones`
              : `⚠ ${pct(outBias)} ones (small sample)`
        }</p>
        <p class="vb-note">Frequency of ones in the debiased output.</p>
      </div>
      <div class="verdict-box ${stuck ? 'alarm' : predictable ? 'alarm' : 'ok'}">
        <p class="vb-title">First-order diagnostic — dependence</p>
        <p class="vb-main">${
          stuck
            ? '✕ REJECT — source is dead'
            : predictable
              ? `✕ dependence detected — predictor guesses ${pct(acc)} of output bits`
              : `✓ no first-order dependence detected in this sample (predictor at ${pct(acc)})`
        }</p>
        <p class="vb-note">${
          predictable
            ? 'The bias check and this diagnostic disagree — that disagreement is the lesson: von Neumann fixes bias, not correlation.'
            : 'One predictor finding nothing is not proof of unpredictability — it means this detector, on this sample, found nothing. Guarantees come from the model bound in panel 4.'
        }</p>
      </div>
    `
  })
}

function bitsPreview(bits: Uint8Array): string {
  let out = ''
  const max = Math.min(bits.length, 512)
  for (let i = 0; i < max; i++) {
    if (i > 0 && i % 8 === 0) out += ' '
    out += bits[i]
  }
  if (bits.length > max) out += ` … (+${bits.length - max} more)`
  return out
}
