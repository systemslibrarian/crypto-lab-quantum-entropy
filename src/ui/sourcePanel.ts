import { fractionOnes } from '../entropy/measures.ts'
import { $, bitsToText, html, pct } from './dom.ts'
import { regenerate, setConfig, state, subscribe, STREAM_LEN } from './state.ts'

export function initSourcePanel(root: HTMLElement): void {
  html(
    root,
    `
    <p class="kicker">1 · The source</p>
    <h2 id="source-h">A beam-splitter QRNG — unpredictable by physics, imperfect by engineering</h2>
    <p class="lede">
      Each photon meets a half-silvered mirror and lands on detector A (bit 0) or detector B
      (bit 1). Quantum mechanics says nobody — not even the manufacturer — can predict a single
      outcome. But if detector B is slightly more efficient, the stream is biased; if a click
      echoes into the next time slot, it is correlated. Set the imperfections, then emit photons.
    </p>
    <div class="controls">
      <div class="field">
        <label for="src-bias">Detector mismatch — P(detector B) = <output id="src-bias-out">53%</output></label>
        <input type="range" id="src-bias" min="50" max="70" step="1" value="53" />
      </div>
      <div class="field">
        <label for="src-corr">Correlation (afterpulsing / dead time) = <output id="src-corr-out">0%</output></label>
        <input type="range" id="src-corr" min="0" max="90" step="5" value="0" />
      </div>
      <button id="src-generate">Emit ${STREAM_LEN.toLocaleString('en-US')} photons</button>
      <button id="src-stick" class="secondary" aria-pressed="false">Stick detector B (failure)</button>
    </div>
    <div class="stat-grid" role="status" aria-live="polite" id="src-stats"></div>
    <h3 id="src-stream-h">Raw bit stream</h3>
    <div class="bitscroll" tabindex="0" role="region" aria-labelledby="src-stream-h" id="src-stream"></div>
    <p class="model-note">
      <strong>This source is a model</strong> — those words exactly: the photons are simulated from
      the browser CSPRNG so the imperfections are controllable. Everything downstream of the raw
      stream — the entropy measurements, the debiaser, the extractor, the health tests — is real
      math running on these actual bits.
    </p>
  `,
  )

  const bias = $('#src-bias', root) as HTMLInputElement
  const corr = $('#src-corr', root) as HTMLInputElement

  bias.addEventListener('input', () => {
    $('#src-bias-out', root).textContent = `${bias.value}%`
    setConfig({ pOne: Number(bias.value) / 100 })
  })
  corr.addEventListener('input', () => {
    $('#src-corr-out', root).textContent = `${corr.value}%`
    setConfig({ persistence: Number(corr.value) / 100 })
  })
  $('#src-generate', root).addEventListener('click', () => regenerate())
  const stickBtn = $('#src-stick', root)
  stickBtn.addEventListener('click', () => {
    const nowStuck = state.cfg.stuck === null ? 1 : null
    stickBtn.setAttribute('aria-pressed', String(nowStuck !== null))
    stickBtn.textContent = nowStuck !== null ? 'Un-stick detector B' : 'Stick detector B (failure)'
    setConfig({ stuck: nowStuck })
  })

  subscribe(({ cfg, raw }) => {
    const ones = fractionOnes(raw)
    $('#src-stats', root).innerHTML = `
      <div class="stat"><span class="label">Photons emitted</span>
        <span class="value">${raw.length.toLocaleString('en-US')}</span></div>
      <div class="stat"><span class="label">Detector A clicks (0)</span>
        <span class="value">${(raw.length - Math.round(ones * raw.length)).toLocaleString('en-US')}</span></div>
      <div class="stat"><span class="label">Detector B clicks (1)</span>
        <span class="value">${Math.round(ones * raw.length).toLocaleString('en-US')}</span></div>
      <div class="stat"><span class="label">Measured bias P(1)</span>
        <span class="value">${pct(ones)}</span>
        <span class="note">${cfg.stuck !== null ? 'detector stuck — constant output' : `set point ${pct(cfg.pOne, 0)}`}</span></div>
    `
    $('#src-stream', root).textContent = bitsToText(raw)
  })
}
