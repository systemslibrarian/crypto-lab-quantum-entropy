import { prefixModel } from '../entropy/prefix-model.ts'
import { $ } from './dom.ts'

export function initPrefixPanel(root: HTMLElement): void {
  root.innerHTML = `
    <h3 id="prefix-model">Does 99% entropy mean almost uniform?</h3>
    <p>Predict first: a 1,000-bit string starts with ten known zero bits. Its remaining
      990 bits are independent and fair. Would you accept the entire string as nearly uniform?</p>
    <p class="note">Separate synthetic distribution model — this does not sample the QRNG
      above or change the 256-bit extraction experiment below.</p>
    <div class="field">
      <label for="prefix-d">Known zero prefix: <output id="prefix-d-out">10</output> bits</label>
      <input id="prefix-d" type="range" min="0" max="1000" step="1" value="10" />
    </div>
    <div class="stat-grid" id="prefix-results" role="status" aria-live="polite"></div>
    <details><summary>Explain the distinguisher and the exact distance</summary>
      <p>Check whether the first d bits are all zero. Our source passes with probability 1;
        a uniform 1,000-bit string passes with probability 2⁻ᵈ. The probability gap is
        <strong>1 − 2⁻ᵈ</strong>. Summing the probability differences over all strings gives
        the same total variation distance, so this check is optimal for this model.</p>
      <p>Each supported string has probability 2⁻⁽¹⁰⁰⁰⁻ᵈ⁾, so min-entropy is 1,000 − d bits.
        At d = 0 the distribution is uniform; at d = 1,000 it is a single known string.
        A high entropy rate is not a percentage security score.</p>
    </details>
    <p class="note">The suffix is assumed secret and fair even given the adversary’s information.
      If the whole string is published as a beacon pulse, it is not a secret one-time pad.
      This calculation neither certifies a physical source nor implements a quantum protocol.</p>
    <p class="note">Related research: Jain, Mutreja and Roberts,
      <a href="https://arxiv.org/abs/2609.38945">Certified Randomness with Optimal Rate</a>
      (30 September 2026, preprint; quantum random oracle model). The prefix example is an
      elementary teaching counterexample, not a reproduction or refutation of that protocol.</p>`
  const slider = $('#prefix-d', root) as HTMLInputElement
  const render = () => {
    const d = Number(slider.value)
    const model = prefixModel(1000, d)
    $('#prefix-d-out', root).textContent = String(d)
    const distance = d === 0 ? '0%' : d <= 16
      ? `${(100 * model.distance).toFixed(4)}%` : `1 − 2⁻${d} (very close to 1, but below 1)`
    $('#prefix-results', root).innerHTML = `
      <div class="stat"><span class="label">Min-entropy</span><span class="value">${model.minEntropy} bits</span></div>
      <div class="stat"><span class="label">Entropy rate</span><span class="value">${(100 * model.rate).toFixed(1)}%</span></div>
      <div class="stat"><span class="label">Distance from uniform</span><span class="value">${distance}</span></div>
      <div class="stat"><span class="label">Uniform string passes prefix check</span><span class="value">${d === 0 ? '1' : `2⁻${d}`}</span></div>`
  }
  slider.addEventListener('input', render)
  render()
}
