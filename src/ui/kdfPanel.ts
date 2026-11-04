import { kdfBound } from '../entropy/kdf-bounds.ts'
import { $ } from './dom.ts'

export function initKdfPanel(root: HTMLElement): void {
  root.innerHTML = `<p class="kicker">Application-specific key derivation</p>
    <h2 id="kdf-h">How much does a weak source change an application’s failure bound?</h2>
    <p class="lede">Predict: can a 128-bit source support a useful guarantee for an application expecting a 128-bit key?
      Compare two sufficient bounds, then change an assumption.</p>
    <p>This independent calculator uses stipulated inputs, not the QRNG samples above. It calculates an upper bound on
      success in a specified unpredictability attack game. It does not generate a key.</p>
    <div class="controls"><button id="kdf-example-128">128-bit source example</button>
      <button id="kdf-example-138" class="secondary">138-bit source example</button></div>
    <div class="workshop-controls kdf-controls">
      <label>Source length n (bits)<input id="kdf-n" type="number" min="1" max="65536" step="1" value="256" required></label>
      <label>Assumed source min-entropy k (bits)<input id="kdf-k" type="number" min="1" max="65536" step="1" value="128" required></label>
      <label>Derived-key length m (bits)<input id="kdf-m" type="number" min="1" max="65536" step="1" value="128" required></label>
      <label>Baseline exponent b (δ = 2⁻ᵇ)<input id="kdf-b" type="number" min="6" max="256" step="1" value="64" required></label>
      <label>Stated hash independence r (r-wise)<input id="kdf-r" type="number" min="1" max="65536" step="1" value="65" required></label>
      <label>Application game<select id="kdf-game"><option value="unpredictability">Unpredictability (e.g. MAC forgery)</option>
        <option value="indistinguishability">General indistinguishability</option><option value="unknown">Unspecified</option></select></label>
      <label>Public seed model<select id="kdf-seed"><option value="independent-uniform">Uniform and independent of source</option>
        <option value="other">Correlated or fixed seed</option><option value="unknown">Unknown</option></select></label>
      <label>Hash family<select id="kdf-family"><option value="independent">Stated r-wise-independent family</option>
        <option value="hkdf">HKDF or an arbitrary hash</option><option value="unknown">Unknown</option></select></label>
    </div>
    <label class="kdf-assumption"><input id="kdf-model" type="checkbox" checked>
      Use an illustrative model with the source and baseline bounds assumed</label>
    <p class="note">The baseline δ must already account for the application’s adversary and query budget with a uniform key.
      The source bound k must apply under the stated adversary-information model. These inputs are assumptions, not estimates
      from sample bytes; this lesson does not establish a quantum-side-information extension.</p>
    <div id="kdf-result" class="kdf-result" role="status" aria-live="polite" aria-atomic="true"></div>
    <p id="kdf-proof-scope" class="note">These sufficient bounds remain supported under the stated assumptions.
      A separate reverse claim in the source paper is false as written for deterministic tests;
      the corrected statement accounts for their whole-outcome acceptance budget. That correction does not change these calculations.</p>
    <details><summary>Explain the two routes and their limits</summary><div>
      <p>All logarithms are base 2. For integer b from 6 to 256:</p>
      <ul><li><strong>No entropy loss:</strong> k = m, at least (b + 1)-wise independence; bound (b + 1) × 2⁻ᵇ.</li>
        <li><strong>Small entropy loss:</strong> k ≥ m + ⌈log₂ b⌉ + 4, at least (b + 6)-wise independence;
          bound 3 × 2⁻ᵇ. The hash-independence requirement is a conservative sufficient one.</li></ul>
      <p>The sufficient argument splits outcomes into a bad set of mass at most η and a remainder whose probability density
        is at most t times uniform. A test with uniform-input success at most δ then succeeds with probability at most
        η + tδ. The paper’s balance bounds supply η and t. This forward calculation does not require a converse.</p>
      <p>The results are application failure bounds. They do not give output min-entropy, distance from uniform, an HKDF guarantee,
        or a security certificate for a device. The calculator deliberately leaves intermediate entropy gaps unsupported.</p>
    </div></details>
    <details id="kdf-converse"><summary>What was corrected in the reverse claim?</summary><div>
      <p>The reverse claim asks whether limits on every allowed test force the distribution to have few unusually likely outcomes.
        A deterministic test accepts a whole number of output-and-seed pairs. If its budget permits 2.4 pairs, it can accept only two.</p>
      <p>For N equally weighted reference outcomes and a uniform-test budget δ, use q = ⌊δN⌋ and δ_eff = q/N.
        If q ≥ 1 and every allowed deterministic test succeeds with probability at most ε, the corrected density threshold is
        t = ε/δ_eff. The probability of outcomes above that threshold is at most ε. If q = 0, the test premise is vacuous.</p>
      <p>The original threshold t = ε/δ follows when δN is an integer, or from a stronger premise that also covers randomized tests.
        Neither version certifies the source assumptions entered above.
        <a href="https://github.com/systemslibrarian/crypto-lab/blob/main/docs/kdf-converse-resolution-2026-11-04.md">Read the corrected statements, proofs and exact counterexample</a>.</p>
    </div></details>
    <p class="note">Source: Dodis, Pietrzak and Wichs,
      <a href="https://eprint.iacr.org/2013/708">Key Derivation Without Entropy Waste</a> (6 February 2014),
      Corollaries 4.3 and 4.5, PDF pp. 11–12.
      <a href="https://github.com/systemslibrarian/crypto-lab/blob/main/docs/kdf-converse-resolution-2026-11-04.md">Scope and corrected converse</a>.</p>`
  const number = (id: string) => ($(`#kdf-${id}`, root) as HTMLInputElement).valueAsNumber
  const value = (id: string) => ($(`#kdf-${id}`, root) as HTMLSelectElement).value
  const model = $('#kdf-model', root) as HTMLInputElement
  const output = $('#kdf-result', root)
  const render = () => {
    const result = kdfBound({ n: number('n'), k: number('k'), m: number('m'), b: number('b'), independence: number('r'),
      game: value('game'), seed: value('seed'), family: value('family'), hypothetical: model.checked })
    output.replaceChildren()
    const title = document.createElement('h3')
    title.textContent = result.supported ? 'Conditional model bound' : 'No supported bound'
    const explanation = document.createElement('p')
    output.append(title, explanation)
    if (!result.supported) { explanation.textContent = result.reason; return }
    explanation.textContent = `${result.route === 'no-loss' ? 'No entropy loss' : 'Small entropy loss'} route: application failure probability ≤`
    const exact = document.createElement('p')
    exact.className = 'kdf-bound'
    exact.dataset.kdfBound = 'true'
    exact.textContent = `${result.factor} × 2^−${result.exponent}`
    const detail = document.createElement('p')
    detail.textContent = `Approximately ${result.bound.toExponential(4)}. Uniform-key baseline: 2^−${result.exponent}; guaranteed upper-bound multiplier: ${result.factor}. Required independence: at least ${result.requiredIndependence}-wise.`
    const limit = document.createElement('p')
    limit.className = 'note'
    limit.textContent = 'Conditional on every stated model assumption. They have not been independently verified. A stronger upper bound does not measure actual failure frequency or output entropy.'
    output.append(exact, detail, limit)
  }
  root.querySelectorAll('input, select').forEach(control => { control.addEventListener('input', render); control.addEventListener('change', render) })
  const preset = (k: number, independence: number) => {
    for (const [id, v] of Object.entries({ n: 256, k, m: 128, b: 64, r: independence })) ($(`#kdf-${id}`, root) as HTMLInputElement).value = String(v)
    for (const [id, v] of Object.entries({ game: 'unpredictability', seed: 'independent-uniform', family: 'independent' })) ($(`#kdf-${id}`, root) as HTMLSelectElement).value = v
    model.checked = true
    render()
  }
  $('#kdf-example-128', root).addEventListener('click', () => preset(128, 65))
  $('#kdf-example-138', root).addEventListener('click', () => preset(138, 70))
  render()
}
