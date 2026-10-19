import { aptCutoff, rctCutoff } from '../entropy/healthtests.ts'
import { AFTER, PREFIX, TRIALS, aptWindowProbability, runWorkshop } from '../entropy/health-workshop.ts'
import type { Failure } from '../entropy/health-workshop.ts'

export function initHealthWorkshop(root: HTMLElement): void {
  root.innerHTML = `<p class="kicker">5a · Choose a tripwire</p>
    <h2 id="workshop-h">The source has failed. Will your monitor notice?</h2>
    <p class="lede">Choose a failure, predict which test will catch it, then change the cutoffs.
    A lower threshold can catch more failures and also reject more healthy runs.</p>
    <div class="workshop-controls">
      <label>Failure after ${PREFIX.toLocaleString()} healthy samples
        <select id="hw-failure"><option value="bias">Bias shifts from 53% to 65% ones</option>
        <option value="sticky">85% chance of repeating the preceding bit</option>
        <option value="stuck">Detector sticks at 1</option>
        <option value="alternating">Predictable 010101… (balanced, no long runs)</option></select></label>
      <label>APT window <select id="hw-window"><option>128</option><option>512</option><option selected>1024</option><option>2048</option></select></label>
      <label>APT alarm count <input id="hw-cutoff" type="number" min="2" max="1025" step="1"></label>
      <label>RCT alarm run <input id="hw-rct" type="number" min="2" max="128" step="1"></label>
    </div>
    <div class="controls"><button id="hw-run">Test this setting</button>
      <button id="hw-preset" class="secondary">Restore formula cutoffs</button></div>
    <div id="hw-result" role="status" aria-live="polite"></div>
    <p class="note">${TRIALS} reproducible simulated trials, each with ${PREFIX.toLocaleString()} healthy IID 53/47 samples,
    followed by ${AFTER.toLocaleString()} failed-source samples. Fixed public seeds; never key material.
    Early alarms remove that trial from the detection denominator. Delays count from failure onset,
    among detected trials only. Zero observed alarms in this small experiment does not establish a rare-event rate.</p>
    <details><summary>Why the model and the window matter</summary><div>
      <p>The IID probability below weights both possible first-symbol references and counts the first symbol itself:
      p·Pr[Binomial(W−1,p) ≥ C−1] + (1−p)·Pr[Binomial(W−1,1−p) ≥ C−1]. It is computed by summing probabilities,
      not taken from a simulation table. It applies to the healthy IID model, not the correlated failure.</p>
      <p>The preset uses this lab’s existing printed §4.4 cutoff convention, with H = −log₂(0.53) and α = 2⁻²⁰.
      The actual false-alarm probability need not equal α. The other windows and manual thresholds are teaching choices;
      deployment requires source-specific justification. These controls do not change the commissioned monitor above.</p>
    </div></details>
    <p class="note">Lesson informed by <strong>Joshua E. Hill</strong>,
      <a href="https://www.untruth.org/~josh/sp80090b/N23A%20HillJ%20The%20SP800-90B%20Approved%20Health%20Tests%20and%20Their%20Cutoffs.pdf" target="_blank" rel="noopener noreferrer">The SP 800-90B Approved Health Tests and Their Cutoffs</a>
      (ICMC, 19 September 2024), especially slides 2–8 and 13–17. Hill supplies the failure-mode and statistical-power analysis;
      Crypto Lab supplies this original experiment and calculations. Test definitions:
      <a href="https://csrc.nist.gov/pubs/sp/800/90/b/final" target="_blank" rel="noopener noreferrer">NIST SP 800-90B §4.4</a>.
      Attribution does not imply Hill’s review or endorsement.</p>`
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(id)!
  const w = get<HTMLSelectElement>('#hw-window'), c = get<HTMLInputElement>('#hw-cutoff'), r = get<HTMLInputElement>('#hw-rct')
  const failure = get<HTMLSelectElement>('#hw-failure'), output = get<HTMLDivElement>('#hw-result')
  const run = () => {
    if (!c.reportValidity() || !r.reportValidity()) return
    const rows = runWorkshop(failure.value as Failure, +w.value, +c.value, +r.value)
    output.innerHTML = `<div class="verdict-pair">${rows.map((s, i) => `<div class="verdict-box neutral">
      <p class="vb-title">${i === 0 ? 'RCT — long runs' : 'APT — repeated reference'}</p>
      <p class="vb-main">Detected ${s.detected} / ${s.eligible} eligible failures</p>
      <p>${s.falseAlarms} / ${TRIALS} trials alarmed before the failure.<br>
      ${s.eligible - s.detected} eligible failures missed within ${AFTER.toLocaleString()} samples.<br>
      Median detection delay: ${s.medianDelay === null ? 'no detections' : `${s.medianDelay} samples`}.</p></div>`).join('')}</div>
      <p>Analytical APT false-alarm probability per complete healthy IID window:
      <strong>${aptWindowProbability(+w.value, +c.value, 0.53).toExponential(3)}</strong>.</p>
      <p>${failure.value === 'alternating' ? 'A balanced, completely predictable sequence can evade both monitors. Choose a test for the failure you need to detect; passing these two tests cannot establish unpredictability.' :
        failure.value === 'sticky' ? 'Repeating the preceding sample changes dependence while preserving the long-run 53/47 marginal distribution. A histogram alone hides this failure.' :
        'Compare a lower cutoff with a larger window. Detection frequency, false alarms, and delay answer different questions.'}</p>`
  }
  const preset = () => { c.max = String(+w.value + 1); c.value = String(aptCutoff(-Math.log2(0.53), +w.value)); r.value = String(rctCutoff(-Math.log2(0.53))); run() }
  w.addEventListener('change', preset)
  failure.addEventListener('change', run)
  get('#hw-run').addEventListener('click', run)
  get('#hw-preset').addEventListener('click', preset)
  preset()
}
