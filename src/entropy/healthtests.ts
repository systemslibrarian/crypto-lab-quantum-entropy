import type { APTResult, BitStream, RCTResult } from './types.ts'

/**
 * NIST SP 800-90B §4.4 continuous health tests, for a binary source.
 *
 * These run FOREVER inside a real entropy source. They are not entropy
 * estimators — they are tripwires for catastrophic failure (a stuck detector,
 * a dead laser), tuned so a healthy source at the claimed entropy level
 * false-alarms with probability α = 2^-20 per test evaluation.
 */

const ALPHA_EXP = 20 // α = 2^-20, the SP 800-90B recommended false-positive rate

/**
 * Repetition Count Test cutoff (SP 800-90B §4.4.1):
 *   C = 1 + ⌈-log₂α / H⌉ = 1 + ⌈20/H⌉
 * where H is the claimed min-entropy per sample. For a full-entropy binary
 * source (H = 1): C = 21. The spec's own worked example: H = 7.3 → C = 4.
 */
export function rctCutoff(h: number): number {
  return 1 + Math.ceil(ALPHA_EXP / h)
}

/** Run the RCT over a stream: fire when a run of identical samples reaches C. */
export function runRCT(bits: BitStream, cutoff: number): RCTResult {
  let run = 1
  let maxRun = bits.length > 0 ? 1 : 0
  let failedAt: number | null = null
  for (let i = 1; i < bits.length; i++) {
    run = bits[i] === bits[i - 1] ? run + 1 : 1
    if (run > maxRun) maxRun = run
    if (run >= cutoff && failedAt === null) failedAt = i
  }
  return { maxRun, failedAt }
}

/**
 * Adaptive Proportion Test cutoff (SP 800-90B §4.4.2):
 *   C = 1 + CRITBINOM(W, 2^-H, 1 - α)
 * i.e. one more than the smallest x with Binom(W, 2^-H).cdf(x) ≥ 1 - 2^-20.
 * Binary sources use window W = 1024.
 */
export const APT_WINDOW = 1024

export function aptCutoff(h: number, w: number = APT_WINDOW): number {
  return 1 + critBinom(w, Math.pow(2, -h), 1 - Math.pow(2, -ALPHA_EXP))
}

/** Smallest x such that P[Binom(n,p) ≤ x] ≥ target. Exact summation in log space. */
export function critBinom(n: number, p: number, target: number): number {
  // log factorials 0..n
  const logFact = new Float64Array(n + 1)
  for (let i = 2; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i)
  const logP = Math.log(p)
  const logQ = Math.log1p(-p)
  let cdf = 0
  for (let x = 0; x <= n; x++) {
    const logPmf = logFact[n] - logFact[x] - logFact[n - x] + x * logP + (n - x) * logQ
    cdf += Math.exp(logPmf)
    if (cdf >= target) return x
  }
  return n
}

/**
 * Run the APT: for each disjoint window of W samples, take the first sample as
 * reference and count its occurrences in the window; fire if the count ≥ C.
 */
export function runAPT(bits: BitStream, cutoff: number, w: number = APT_WINDOW): APTResult {
  let maxCount = 0
  let failedWindow: number | null = null
  const windows = Math.floor(bits.length / w)
  for (let wi = 0; wi < windows; wi++) {
    const start = wi * w
    const ref = bits[start]
    let count = 0
    for (let i = start; i < start + w; i++) if (bits[i] === ref) count++
    if (count > maxCount) maxCount = count
    if (count >= cutoff && failedWindow === null) failedWindow = wi
  }
  return { maxCount, failedWindow, windowsTested: windows }
}
