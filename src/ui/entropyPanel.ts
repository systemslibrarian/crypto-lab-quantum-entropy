import { blockMinEntropy } from '../entropy/blockentropy.ts'
import {
  fractionOnes,
  markovPredictorAccuracy,
  minEntropy,
  shannonEntropy,
} from '../entropy/measures.ts'
import { $, fmt, html, pct } from './dom.ts'
import { BLOCK_LEN, subscribe } from './state.ts'

/** Chart geometry: most frequent bit fraction p ∈ [0.5, 1] → x, entropy ∈ [0, 1] → y. */
const W = 460
const H = 260
const PAD = { l: 44, r: 14, t: 12, b: 34 }
const px = (p: number) => PAD.l + ((p - 0.5) / 0.5) * (W - PAD.l - PAD.r)
const py = (h: number) => H - PAD.b - h * (H - PAD.t - PAD.b)

function curvePath(f: (p: number) => number): string {
  const pts: string[] = []
  for (let i = 0; i <= 200; i++) {
    const p = 0.5 + (i / 200) * 0.5
    pts.push(`${i === 0 ? 'M' : 'L'}${px(p).toFixed(1)},${py(f(p)).toFixed(1)}`)
  }
  return pts.join('')
}

export function initEntropyPanel(root: HTMLElement): void {
  html(
    root,
    `
    <p class="kicker">2 · Headline — the two numbers</p>
    <h2 id="entropy-h">Shannon entropy is <span id="ent-headline-shannon">0.9974</span> bits per bit. How likely is one correct guess?</h2>
    <p class="lede">
      Both measurements below run live on the same raw stream. Shannon entropy is the
      <em>average</em> surprise across all outcomes.
      Min-entropy is the <em>worst case</em>: the single most likely outcome, and gives the success probability of one optimal guess. Slide the detector
      mismatch above and watch Shannon barely move while min-entropy falls off a cliff.
    </p>
    <div class="stat-grid" id="ent-stats"></div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" id="ent-chart"
        aria-label="Chart of Shannon entropy and min-entropy in bits per bit, as functions of the frequency of the more common bit from 0.5 to 1.0. The Shannon curve stays near 1 for small biases; the min-entropy line drops much faster. A marker shows the current measured bias.">
        <line class="axis" x1="${PAD.l}" y1="${py(0)}" x2="${W - PAD.r}" y2="${py(0)}"/>
        <line class="axis" x1="${PAD.l}" y1="${py(0)}" x2="${PAD.l}" y2="${PAD.t}"/>
        <line class="axis" x1="${PAD.l}" y1="${py(1)}" x2="${W - PAD.r}" y2="${py(1)}" stroke-dasharray="3 4"/>
        <text x="${PAD.l - 6}" y="${py(1) + 4}" text-anchor="end">1.0</text>
        <text x="${PAD.l - 6}" y="${py(0.5) + 4}" text-anchor="end">0.5</text>
        <text x="${PAD.l - 6}" y="${py(0) + 4}" text-anchor="end">0</text>
        <text x="${px(0.5)}" y="${H - 12}" text-anchor="middle">50%</text>
        <text x="${px(0.75)}" y="${H - 12}" text-anchor="middle">75%</text>
        <text x="${px(1)}" y="${H - 12}" text-anchor="end">100%</text>
        <text x="${(PAD.l + W - PAD.r) / 2}" y="${H - 1}" text-anchor="middle">more common bit frequency</text>
        <path d="${curvePath(shannonEntropy)}" fill="none" stroke="var(--ok-ink)" stroke-width="2.5"/>
        <path d="${curvePath(minEntropy)}" fill="none" stroke="var(--danger-ink)" stroke-width="2.5"/>
        <text x="${px(0.84)}" y="${py(shannonEntropy(0.84)) - 8}" style="fill: var(--ok-ink); font-weight: 700">Shannon H</text>
        <text x="${px(0.62)}" y="${py(minEntropy(0.62)) + 20}" style="fill: var(--danger-ink); font-weight: 700">min-entropy H∞</text>
        <g id="ent-marker">
          <line x1="0" y1="${PAD.t}" x2="0" y2="${py(0)}" stroke="var(--accent-ink)" stroke-dasharray="4 3"/>
        </g>
      </svg>
    </div>
    <div class="verdict-pair" id="ent-verdicts" role="status" aria-live="polite"></div>
    <details>
      <summary>The formulas, and why averaging is the wrong model of an attacker</summary>
      <div>
        <p><span class="formula">H(p) = −p·log₂p − (1−p)·log₂(1−p)</span> &nbsp;
           <span class="formula">H∞(p) = −log₂ max(p, 1−p)</span></p>
        <p class="note">
          Shannon entropy weights every outcome by how often it occurs — it answers “how well does
          an independent source compress in the limit?” Min-entropy gives the largest probability
          of one outcome. For 256 independent bits with P(1) = 0.53, the most likely string is all
          ones. Its probability is 0.53<sup>256</sup> ≈ 2<sup>−234.5</sup>. All 2<sup>256</sup> strings
          remain possible. Computing the mean number of guesses would require their probabilities and guess order.
        </p>
        <p class="note">
          These per-bit measurements describe the observed frequencies of zeros and ones.
          Multiplying a per-bit entropy by the block length assumes independence. The block
          calculation below uses the configured source model and includes its dependence.
        </p>
      </div>
    </details>
  `,
  )

  subscribe(({ raw, cfg }) => {
    const p = fractionOnes(raw)
    const hSh = shannonEntropy(p)
    const hMin = minEntropy(p)
    const acc = markovPredictorAccuracy(raw)
    const correlated = cfg.persistence > 0 || cfg.stuck !== null
    const kModel = blockMinEntropy(BLOCK_LEN, cfg)

    $('#ent-headline-shannon', root).textContent = fmt(hSh)

    $('#ent-stats', root).innerHTML = `
      <div class="stat"><span class="label">Measured bias P(1)</span>
        <span class="value">${pct(p)}</span></div>
      <div class="stat"><span class="label">Shannon H</span>
        <span class="value">${fmt(hSh)} bits/bit</span>
        <span class="note">average surprise at the measured bias</span></div>
      <div class="stat"><span class="label">Min-entropy H∞</span>
        <span class="value">${fmt(hMin)} bits/bit</span>
        <span class="note">what one optimal guess faces</span></div>
      <div class="stat"><span class="label">Attacker’s single guess succeeds</span>
        <span class="value">${pct(Math.max(p, 1 - p))}</span>
        <span class="note">= 2^−H∞ per bit, at the measured bias</span></div>
      <div class="stat"><span class="label">Optimal one-guess success for the whole ${BLOCK_LEN}-bit block</span>
        <span class="value">${kModel === 0 ? '100%' : `2^−${fmt(kModel, 1)}`}</span>
        <span class="note">Most likely block in this model. For comparison, ${BLOCK_LEN} times the sample
        Shannon entropy is ${fmt(BLOCK_LEN * hSh, 1)} bits under an independence assumption.</span></div>
    `

    const majority = Math.max(p, 1 - p)
    const marker = $('#ent-marker', root)
    marker.setAttribute('transform', `translate(${px(majority).toFixed(1)},0)`)

    const gap = hSh - hMin
    $('#ent-verdicts', root).innerHTML = `
      <div class="verdict-box neutral">
        <p class="vb-title">Sample Shannon entropy</p>
        <p class="vb-main">${fmt(hSh)} bits/bit</p>
        <p class="vb-note">Average surprise for the measured bit frequencies.</p>
      </div>
      <div class="verdict-box ${gap > 0.02 || correlated ? 'warn' : 'ok'}">
        <p class="vb-title">Model block min-entropy per bit</p>
        <p class="vb-main">${kModel === 0 || correlated || gap > 0.02 ? '⚠' : '✓'} model rate ${fmt(kModel / BLOCK_LEN)} bits/bit</p>
        <p class="vb-note">${correlated
          ? `First-order diagnostic: a predictor guesses ${pct(acc)} of this sample’s bits. The model rate includes the configured dependence.`
          : `Gap to Shannon: ${fmt(gap)} bits/bit in the sample. The model rate uses the configured source probabilities.`
        }</p>
      </div>
    `
  })
}
