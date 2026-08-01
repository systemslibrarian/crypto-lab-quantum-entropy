import { blockMinEntropy } from '../entropy/blockentropy.ts'
import {
  fractionOnes,
  markovPredictorAccuracy,
  minEntropy,
  shannonEntropy,
} from '../entropy/measures.ts'
import { $, fmt, html, pct } from './dom.ts'
import { BLOCK_LEN, subscribe } from './state.ts'

/** Chart geometry: p ∈ [0.5, 1] → x, entropy ∈ [0, 1] → y. */
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
    <h2 id="entropy-h">Shannon says “<span id="ent-headline-shannon">99.7%</span> random.” Min-entropy says otherwise.</h2>
    <p class="lede">
      Both measurements below run live on the same raw stream. Shannon entropy is the
      <em>average</em> surprise across all outcomes — the number that ends up in marketing.
      Min-entropy is the <em>worst case</em>: the single most likely outcome, because an attacker
      trying to guess your bit only guesses once, and guesses optimally. Slide the detector
      mismatch above and watch Shannon barely move while min-entropy falls off a cliff.
    </p>
    <div class="stat-grid" id="ent-stats"></div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" id="ent-chart"
        aria-label="Chart of Shannon entropy and min-entropy in bits per bit, as functions of the bias P(1) from 0.5 to 1.0. The Shannon curve stays near 1 for small biases; the min-entropy line drops much faster. A marker shows the current measured bias.">
        <line class="axis" x1="${PAD.l}" y1="${py(0)}" x2="${W - PAD.r}" y2="${py(0)}"/>
        <line class="axis" x1="${PAD.l}" y1="${py(0)}" x2="${PAD.l}" y2="${PAD.t}"/>
        <line class="axis" x1="${PAD.l}" y1="${py(1)}" x2="${W - PAD.r}" y2="${py(1)}" stroke-dasharray="3 4"/>
        <text x="${PAD.l - 6}" y="${py(1) + 4}" text-anchor="end">1.0</text>
        <text x="${PAD.l - 6}" y="${py(0.5) + 4}" text-anchor="end">0.5</text>
        <text x="${PAD.l - 6}" y="${py(0) + 4}" text-anchor="end">0</text>
        <text x="${px(0.5)}" y="${H - 12}" text-anchor="middle">50%</text>
        <text x="${px(0.75)}" y="${H - 12}" text-anchor="middle">75%</text>
        <text x="${px(1)}" y="${H - 12}" text-anchor="end">100%</text>
        <text x="${(PAD.l + W - PAD.r) / 2}" y="${H - 1}" text-anchor="middle">bias P(1)</text>
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
          this stream compress?” Min-entropy keeps only the most likely outcome — it answers “how
          often does an optimal attacker succeed in one guess?” For keys, only the second question
          matters: per NIST SP 800-90B, entropy claims for sources are min-entropy claims. For a
          256-bit key built from bits with H∞ = 0.9159, the attacker’s effective search space is
          2<sup>234.5</sup>, not 2<sup>255.3</sup> — the Shannon figure overstates the defense by
          20+ bits of work.
        </p>
        <p class="note">
          Caveat these per-bit numbers share: both assume the bits are independent. If the stream
          is also <em>correlated</em>, even min-entropy-from-bias overstates what is there — that
          is why, once you add correlation, the chargeable number comes from the configured
          model’s most-likely-path bound, with the sample predictor shown only as a diagnostic.
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
    const hCond = acc > 0 && acc < 1 ? -Math.log2(acc) : 0
    const correlated = cfg.persistence > 0 || cfg.stuck !== null
    // Two lanes: the sample statistics above are diagnostics; anything phrased as
    // attacker work must come from the configured model, not from the sample.
    const kModel = blockMinEntropy(BLOCK_LEN, cfg)

    // The headline quotes the live Shannon figure, not the default device's. A hardcoded
    // "99.7%" was true only at 53/47; drag the bias to 70% and the heading contradicted the
    // statistic printed directly beneath it. This panel's entire argument is that a number
    // can be true and still mislead — it cannot afford a number that is simply stale.
    $('#ent-headline-shannon', root).textContent = pct(hSh)

    $('#ent-stats', root).innerHTML = `
      <div class="stat"><span class="label">Measured bias P(1)</span>
        <span class="value">${pct(p)}</span></div>
      <div class="stat"><span class="label">Shannon H</span>
        <span class="value">${fmt(hSh)} bits/bit</span>
        <span class="note">the marketing number</span></div>
      <div class="stat"><span class="label">Min-entropy H∞</span>
        <span class="value">${fmt(hMin)} bits/bit</span>
        <span class="note">what one optimal guess faces</span></div>
      <div class="stat"><span class="label">Attacker’s single guess succeeds</span>
        <span class="value">${pct(Math.max(p, 1 - p))}</span>
        <span class="note">= 2^−H∞ per bit, at the measured bias</span></div>
      <div class="stat"><span class="label">Naive ${BLOCK_LEN}-bit key — model attacker work</span>
        <span class="value">${kModel === 0 ? '1 guess' : `2^${fmt(kModel, 1)}`}</span>
        <span class="note">exact for the configured model (most likely ${BLOCK_LEN}-bit path);
        Shannon math would claim 2^${fmt(BLOCK_LEN * hSh, 1)}</span></div>
    `

    const pClamped = Math.min(0.999, Math.max(p, 1 - p))
    const marker = $('#ent-marker', root)
    marker.setAttribute('transform', `translate(${px(pClamped).toFixed(1)},0)`)

    const gap = hSh - hMin
    $('#ent-verdicts', root).innerHTML = `
      <div class="verdict-box neutral">
        <p class="vb-title">Advertised (Shannon)</p>
        <p class="vb-main">“${pct(hSh, 2)} random!”</p>
        <p class="vb-note">True as an average — and irrelevant to a one-shot guesser.</p>
      </div>
      <div class="verdict-box ${gap > 0.02 || correlated ? 'warn' : 'ok'}">
        <p class="vb-title">Chargeable (min-entropy)</p>
        <p class="vb-main">${
          correlated && hCond < hMin
            ? `⚠ dependence detected — model rate ${fmt(kModel / BLOCK_LEN)} bits/bit`
            : `${gap > 0.02 ? '⚠' : '✓'} ${fmt(hMin)} bits/bit at the measured bias`
        }</p>
        <p class="vb-note">${
          correlated && hCond < hMin
            ? `First-order diagnostic: a predictor guesses ${pct(acc)} of this sample’s bits, so bias alone no longer describes the source; the chargeable rate comes from the model’s most-likely-path bound.`
            : `Gap to Shannon: ${fmt(gap)} bits/bit. Only min-entropy may back a key — and for the extraction budget, only the model bound (panel 4).`
        }</p>
      </div>
    `
  })
}
