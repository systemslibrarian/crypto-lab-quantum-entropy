import { fractionOnes, markovPredictorAccuracy, minEntropy } from '../entropy/measures.ts'
import { lhlEpsilon, toeplitzExtract } from '../entropy/toeplitz.ts'
import type { ToeplitzResult } from '../entropy/types.ts'
import { $, bitsToHex, fmt, html, sci } from './dom.ts'
import { state, subscribe } from './state.ts'

const N = 256 // input bits taken from the raw stream
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
      distance ε of uniform — <em>provided</em> m stays below the min-entropy k you actually have.
      The multiply below is a real GF(2) matrix–vector product on the first ${N} bits of the raw
      stream. Choose the output length, then extract — and try demanding more bits than the stream
      contains.
    </p>
    <div class="controls">
      <div class="field">
        <label for="tp-m">Output length m = <output id="tp-m-out">128</output> bits</label>
        <input type="range" id="tp-m" min="8" max="${N}" step="8" value="128" />
      </div>
      <button id="tp-extract">Draw fresh seed &amp; extract</button>
    </div>
    <div class="stat-grid" role="status" aria-live="polite" id="tp-stats"></div>
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
        <p><span class="formula">ε ≤ ½·√(2^(m−k))</span> &nbsp;equivalently&nbsp;
           <span class="formula">m ≤ k − 2·log₂(1/ε)</span></p>
        <p class="note">
          Three consequences, all visible above. (1) <strong>You cannot extract more than you
          have:</strong> as m approaches k the guarantee evaporates — ε is a bound on how well ANY
          distinguisher can tell your output from uniform, and once ε is large the bound says
          nothing. (2) <strong>The extractor needs its own seed:</strong> the m+${N}−1 matrix bits
          are drawn fresh and uniform from the browser CSPRNG — the extractor spends clean
          randomness to launder dirty randomness; it cannot create any. Because Toeplitz hashing is
          a <em>strong</em> extractor, that seed may be public and reused across independent
          inputs. (3) <strong>The output length is a security parameter, not a throughput
          choice:</strong> picking m is picking ε.
        </p>
        <div id="tp-row0" class="note"></div>
      </div>
    </details>
  `,
  )

  const mSlider = $('#tp-m', root) as HTMLInputElement
  let last: ToeplitzResult | null = null
  let lastM = 0

  function kEstimate(): { k: number; basis: string } {
    const raw = state.raw
    const input = raw.subarray(0, N)
    if (input.length < N) return { k: 0, basis: 'no stream yet' }
    const p = fractionOnes(raw)
    const hBias = minEntropy(p)
    const acc = markovPredictorAccuracy(raw)
    const hPred = acc > 0 && acc < 1 ? -Math.log2(acc) : 0
    const h = Math.min(hBias, hPred)
    return {
      k: N * h,
      basis:
        h === hBias
          ? `k = ${N} × H∞(bias) = ${N} × ${fmt(hBias)}`
          : `k = ${N} × H∞(predictor) = ${N} × ${fmt(hPred)} — correlation, not bias, is the binding constraint`,
    }
  }

  function renderAccounting(): void {
    const m = Number(mSlider.value)
    $('#tp-m-out', root).textContent = String(m)
    const { k, basis } = kEstimate()
    const eps = lhlEpsilon(k, m)
    const margin = k - m

    $('#tp-stats', root).innerHTML = `
      <div class="stat"><span class="label">Min-entropy in, k</span>
        <span class="value">${fmt(k, 1)} bits</span>
        <span class="note">${basis}</span></div>
      <div class="stat"><span class="label">Bits demanded, m</span>
        <span class="value">${m}</span></div>
      <div class="stat"><span class="label">Security margin k − m</span>
        <span class="value">${fmt(margin, 1)} bits</span></div>
      <div class="stat"><span class="label">Distance from uniform ε ≤</span>
        <span class="value">${eps >= 1 ? '≥ 1 (vacuous)' : sci(eps)}</span></div>
    `

    const ranNote = last
      ? `${lastM} bits produced — the GF(2) multiply always runs fine.`
      : 'Not extracted yet.'
    const level = eps <= Math.pow(2, -32) ? 'ok' : eps <= Math.pow(2, -10) ? 'warn' : 'alarm'
    $('#tp-verdicts', root).innerHTML = `
      <div class="verdict-box ${last ? 'neutral' : 'neutral'}">
        <p class="vb-title">Extractor result (the math)</p>
        <p class="vb-main">${last ? `${lastM} bits output ✓` : '—'}</p>
        <p class="vb-note">${ranNote} Producing output is not evidence of security.</p>
      </div>
      <div class="verdict-box ${level}">
        <p class="vb-title">Security verdict (the lemma)</p>
        <p class="vb-main">${
          level === 'ok'
            ? `✓ ε ≤ ${sci(eps)} — indistinguishable in practice`
            : level === 'warn'
              ? `⚠ ε ≤ ${sci(eps)} — thin margin, not key-grade`
              : `✕ REJECT — ${eps >= 1 ? 'no guarantee at all' : `ε ≤ ${sci(eps)} is far too large`}`
        }</p>
        <p class="vb-note">${
          level === 'alarm'
            ? `You demanded m = ${m} bits from k = ${fmt(k, 1)} bits of min-entropy. The output below still looks perfectly random — that is exactly why the accounting, not the appearance, is the verdict.`
            : `ε bounds every distinguisher’s advantage. Margin of ${fmt(margin, 1)} bits ⇒ ε ≤ ½·2^−${fmt(margin / 2, 1)}.`
        }</p>
      </div>
    `
  }

  function extract(): void {
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
