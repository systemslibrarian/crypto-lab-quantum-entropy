import { blockMinEntropy } from '../entropy/blockentropy.ts'
import { fractionOnes, markovPredictorAccuracy, minEntropy } from '../entropy/measures.ts'
import { lhlEpsilon, toeplitzExtract } from '../entropy/toeplitz.ts'
import type { ToeplitzResult } from '../entropy/types.ts'
import { $, bitsToHex, fmt, html, pct, sci } from './dom.ts'
import { BLOCK_LEN, state, subscribe } from './state.ts'

const N = BLOCK_LEN // input bits taken from the raw stream
const VIZ_ROWS = 12
const VIZ_COLS = 28
const CELL = 11

export function initToeplitzPanel(root: HTMLElement): void {
  html(
    root,
    `
    <p class="kicker">4 · The real tool</p>
    <h2 id="toeplitz-h">Toeplitz extraction — trading quantity for uniformity, with a receipt</h2>
    <p class="lede">
      A Toeplitz matrix over GF(2) is a 2-universal hash: multiply your n dirty bits by a random
      m×n matrix and the Leftover Hash Lemma guarantees the m output bits are within statistical
      distance ε of uniform — <em>provided</em> m stays below the min-entropy k of the input
      <em>distribution</em>. That k comes from the configured source model (the exact probability
      of its single most likely ${N}-bit path), never from statistics measured on the sample being
      extracted — measuring your own input and calling it a guarantee is the classic accounting
      sin. The multiply below is a real GF(2) matrix–vector product on the first ${N} bits of the
      raw stream. Choose the output length, then extract — and try demanding more bits than the
      model contains.
    </p>
    <div class="controls">
      <div class="field">
        <label for="tp-m">Output length m = <output id="tp-m-out">128</output> bits</label>
        <input type="range" id="tp-m" min="8" max="${N}" step="8" value="128" />
      </div>
      <button id="tp-extract">Draw fresh seed &amp; extract</button>
    </div>
    <p class="note" id="tp-gate-note"></p>
    <div class="stat-grid" id="tp-stats"></div>
    <h3>The entropy budget</h3>
    <div class="chart-wrap">
      <svg viewBox="0 0 440 84" role="img" id="tp-budget" aria-label=""></svg>
      <p class="note" style="margin: 0.3rem 0 0">
        The ledger the lemma enforces: of ${N} raw bits, only k carry min-entropy under the
        configured model, and every output bit is drawn against k — never against ${N}. Demand
        past the shaded funds and you are withdrawing uniformity that was never deposited.
      </p>
    </div>
    <div class="verdict-pair" role="status" aria-live="polite" id="tp-verdicts"></div>
    <h3 id="tp-out-h">Extracted output</h3>
    <div class="bitscroll" tabindex="0" role="region" aria-labelledby="tp-out-h" id="tp-output">
      (press “Draw fresh seed &amp; extract”)
    </div>
    <h3>The matrix (top-left ${VIZ_ROWS}×${VIZ_COLS} corner)</h3>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${VIZ_COLS * CELL} ${VIZ_ROWS * CELL}" role="img" id="tp-matrix"
        aria-label="Top-left corner of the Toeplitz matrix: each row is the previous row shifted one cell to the right, so one diagonal band of seed bits defines the whole matrix."
        style="max-width:${VIZ_COLS * CELL}px;display:block"></svg>
      <p class="note" style="margin:0.4rem 0 0">
        Corner zoom of the full m×${N} matrix. Filled = 1. Note the diagonal stripes: every row is
        the previous one shifted right — m+${N}−1 seed bits define the entire matrix.
      </p>
    </div>
    <details>
      <summary>The Leftover Hash Lemma receipt, line by line</summary>
      <div>
        <p><span class="formula">ε(k, m) = ½·√(2^(m−k))</span> &nbsp;solved exactly for m:&nbsp;
           <span class="formula">distance ≤ ε ⟺ m ≤ k + 2 − 2·log₂(1/ε)</span></p>
        <p class="note">
          One convention, carried through code, tests, and this page. (The folk rule
          m ≤ k − 2·log₂(1/ε) is the same statement with an extra 2-bit safety margin — it
          guarantees distance ≤ ε/2.) Three consequences, all visible above. (1) <strong>You
          cannot extract more than you have:</strong> as m approaches k the guarantee evaporates —
          ε bounds how well ANY distinguisher can tell your output from uniform, and once ε is
          large the bound says nothing. (2) <strong>The extractor needs its own seed:</strong> the
          m+${N}−1 matrix bits are drawn fresh and uniform from the browser CSPRNG — the extractor
          spends clean randomness to launder dirty randomness; it cannot create any. Because
          Toeplitz hashing is a <em>strong</em> extractor, that seed may be public and reused
          across independent inputs. (3) <strong>The output length is a security parameter, not a
          throughput choice:</strong> picking m is picking ε.
        </p>
        <p class="note">
          Standards footnote: in SP 800-90B terms, Toeplitz universal hashing is sound extractor
          mathematics, but it is <em>not</em> one of the spec’s listed vetted conditioning
          components (§3.1.5.1). Its guarantee here comes from the Leftover Hash Lemma and a valid
          k — not from appearing in a standards table.
        </p>
        <div id="tp-row0" class="note"></div>
      </div>
    </details>
  `,
  )

  const mSlider = $('#tp-m', root) as HTMLInputElement
  let last: ToeplitzResult | null = null
  let lastM = 0

  function modelK(): number {
    return blockMinEntropy(N, state.cfg)
  }

  function renderAccounting(): void {
    const m = Number(mSlider.value)
    $('#tp-m-out', root).textContent = String(m)
    const k = modelK()
    const eps = lhlEpsilon(k, m)
    const margin = k - m

    const raw = state.raw
    const pHat = fractionOnes(raw)
    const acc = markovPredictorAccuracy(raw)
    $('#tp-stats', root).innerHTML = `
      <div class="stat"><span class="label">Model min-entropy in, k</span>
        <span class="value">${fmt(k, 1)} bits</span>
        <span class="note">−log₂ P(most likely ${N}-bit path) of the configured model</span></div>
      <div class="stat"><span class="label">Bits demanded, m</span>
        <span class="value">${m}</span></div>
      <div class="stat"><span class="label">Security margin k − m</span>
        <span class="value">${fmt(margin, 1)} bits</span></div>
      <div class="stat"><span class="label">Distance from uniform ε ≤</span>
        <span class="value">${eps >= 1 ? '≥ 1 (vacuous)' : sci(eps)}</span></div>
      <div class="stat"><span class="label">Observed sample (diagnostics only)</span>
        <span class="value">p̂ = ${pct(pHat)}</span>
        <span class="note">bias-only H∞(p̂) = ${fmt(minEntropy(pHat))}/bit; first-order predictor
        ${pct(acc)} — measured on this one sample, never part of the budget</span></div>
    `

    const blocked = state.health.latched
    ;($('#tp-extract', root) as HTMLButtonElement).disabled = blocked
    $('#tp-gate-note', root).innerHTML = blocked
      ? '<strong>Blocked by the source boundary:</strong> a health alarm is latched (panel 5). A real conditioner never accepts material from an alarmed source — repair and recommission first.'
      : ''

    const level = eps <= Math.pow(2, -32) ? 'ok' : eps <= Math.pow(2, -10) ? 'warn' : 'alarm'
    $('#tp-verdicts', root).innerHTML = `
      <div class="verdict-box neutral">
        <p class="vb-title">Extractor result (the math)</p>
        <p class="vb-main">${last ? `${lastM} bits output ✓` : '—'}</p>
        <p class="vb-note">${
          last ? `${lastM} bits produced — the GF(2) multiply always runs fine.` : 'Not extracted yet.'
        } Producing output is not evidence of security.</p>
      </div>
      <div class="verdict-box ${level}">
        <p class="vb-title">Policy verdict on the lemma’s bound</p>
        <p class="vb-main">${
          level === 'ok'
            ? `✓ ε ≤ ${sci(eps)} — below this lab’s 2⁻³² accept line`
            : level === 'warn'
              ? `⚠ ε ≤ ${sci(eps)} — thin margin under this lab’s policy`
              : `✕ REJECT — ${eps >= 1 ? 'the bound is vacuous' : `ε ≤ ${sci(eps)} is far above the accept line`}`
        }</p>
        <p class="vb-note">${
          level === 'alarm'
            ? `You demanded m = ${m} bits from k = ${fmt(k, 1)} bits of model min-entropy. The output below still looks perfectly random — that is exactly why the accounting, not the appearance, is the verdict.`
            : `The lemma supplies the bound; the 2⁻³²/2⁻¹⁰ lines are this lab’s teaching policy, not part of the theorem. Margin ${fmt(margin, 1)} bits ⇒ ε ≤ ½·2^−${fmt(margin / 2, 1)}.`
        }</p>
      </div>
    `
    renderBudget(m, k)
  }

  function renderBudget(m: number, k: number): void {
    const svg = $('#tp-budget', root)
    const X0 = 10
    const SCALE = 420 / N
    const x = (bits: number) => X0 + bits * SCALE
    const overdraft = m > k
    svg.setAttribute(
      'aria-label',
      `Entropy budget bar: of ${N} raw bits, the model provides k = ${k.toFixed(1)} bits of min-entropy. ` +
        (overdraft
          ? `You demanded m = ${m} bits — an overdraft of ${(m - k).toFixed(1)} bits past the available entropy.`
          : `You demanded m = ${m} bits, leaving a security margin of ${(k - m).toFixed(1)} bits.`),
    )
    svg.innerHTML = `
      <rect x="${X0}" y="34" width="${420}" height="18" rx="4" fill="none" stroke="var(--border)"/>
      <rect x="${X0}" y="34" width="${Math.max(0, k * SCALE)}" height="18" rx="4"
        fill="color-mix(in oklab, var(--accent) 45%, transparent)"/>
      ${
        overdraft
          ? `<rect x="${x(k)}" y="34" width="${(m - k) * SCALE}" height="18"
               fill="color-mix(in oklab, #dc2626 55%, transparent)"/>
             <text x="${Math.min(x((k + m) / 2), 380)}" y="80" text-anchor="middle"
               style="fill: var(--danger-ink); font-weight: 700">overdraft ${(m - k).toFixed(1)} bits</text>`
          : `<text x="${x((m + k) / 2)}" y="80" text-anchor="middle">margin ${(k - m).toFixed(1)} bits</text>`
      }
      <line x1="${x(m)}" y1="26" x2="${x(m)}" y2="60" stroke="var(--text)" stroke-width="2"/>
      <text x="${Math.min(Math.max(x(m), 30), 400)}" y="20" text-anchor="middle" style="fill: var(--text); font-weight: 700">m = ${m}</text>
      <text x="${Math.min(Math.max(x(k), 40), 390)}" y="66" text-anchor="${k > N * 0.85 ? 'end' : 'middle'}"
        style="fill: var(--accent-ink); font-weight: 700">k = ${k.toFixed(1)}</text>
    `
  }

  function extract(): void {
    if (state.health.latched) return // fail closed even if the disabled state is bypassed
    const m = Number(mSlider.value)
    const input = state.raw.subarray(0, N)
    if (input.length < N) return
    const seed = new Uint8Array(m + N - 1)
    const bytes = new Uint8Array(seed.length)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < seed.length; i++) seed[i] = bytes[i] & 1
    last = toeplitzExtract(input, seed, m)
    lastM = m
    $('#tp-output', root).textContent =
      `hex: ${bitsToHex(last.output)}  (${m} bits from ${N} raw bits; seed spent: ${seed.length} uniform bits)`
    renderMatrix(last)
    renderRow0(last, input)
    renderAccounting()
  }

  function renderMatrix(res: ToeplitzResult): void {
    const svg = $('#tp-matrix', root)
    let cells = ''
    for (let i = 0; i < Math.min(VIZ_ROWS, res.rows.length); i++) {
      for (let j = 0; j < Math.min(VIZ_COLS, res.rows[i].length); j++) {
        cells += `<rect x="${j * CELL}" y="${i * CELL}" width="${CELL - 1}" height="${CELL - 1}" class="matrix-cell-${res.rows[i][j]}"/>`
      }
    }
    svg.innerHTML = cells
  }

  function renderRow0(res: ToeplitzResult, input: Uint8Array): void {
    const row = res.rows[0]
    let matched = 0
    for (let j = 0; j < input.length; j++) if (row[j] & input[j]) matched++
    $('#tp-row0', root).innerHTML = `
      <strong>Row 0, spelled out:</strong> output[0] = row₀ · input over GF(2) = XOR of the input
      bits where row 0 has a 1 → ${matched} matched ones → parity ${matched % 2} =
      output bit <code>${res.output[0]}</code>. Every one of the ${res.output.length} output bits
      is such a parity over ~half the input.
    `
  }

  mSlider.addEventListener('input', renderAccounting)
  $('#tp-extract', root).addEventListener('click', extract)
  subscribe(() => {
    last = null
    $('#tp-output', root).textContent = '(stream changed — press “Draw fresh seed & extract”)'
    $('#tp-matrix', root).innerHTML = ''
    $('#tp-row0', root).textContent = ''
    renderAccounting()
  })
}
