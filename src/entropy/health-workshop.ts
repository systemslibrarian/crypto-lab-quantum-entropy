/** Original teaching implementation inspired by Joshua E. Hill, ICMC 2024,
 * “The SP 800-90B Approved Health Tests and Their Cutoffs”, slides 2–8, 13–17.
 * No Hill code or numerical tables are copied. These are simulated experiments.
 */
import { makeTestRng } from './source.ts'

export type Failure = 'bias' | 'sticky' | 'stuck' | 'alternating'
export const TRIALS = 64
export const PREFIX = 2048
export const AFTER = 8192

/** P[Binomial(n,p) >= k], summed in log space (no 1-CDF cancellation). */
export function binomialTail(n: number, p: number, k: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  if (p === 0) return 0
  if (p === 1) return 1
  let logChoose = 0
  let total = 0
  for (let j = 0; j <= n; j++) {
    if (j >= k) total += Math.exp(logChoose + j * Math.log(p) + (n - j) * Math.log1p(-p))
    if (j < n) logChoose += Math.log(n - j) - Math.log(j + 1)
  }
  return Math.min(1, total)
}

/** Binary IID APT: the reference already contributes one count. This is
 * an analytical probability for the chosen model, NOT an entropy estimate. */
export function aptWindowProbability(w: number, cutoff: number, p: number): number {
  return p * binomialTail(w - 1, p, cutoff - 1) +
    (1 - p) * binomialTail(w - 1, 1 - p, cutoff - 1)
}

/** First alarm, as a one-based sample count, using the existing RCT/APT rules. */
export function firstAlarms(bits: Uint8Array, w: number, c: number, r: number): [number | null, number | null] {
  let run = 0, prev = -1, ref = -1, count = 0
  let rct: number | null = null, apt: number | null = null
  for (let i = 0; i < bits.length; i++) {
    run = bits[i] === prev ? run + 1 : 1
    prev = bits[i]
    if (run >= r && rct === null) rct = i + 1
    if (i % w === 0) { ref = bits[i]; count = 0 }
    if (bits[i] === ref) count++
    if (count >= c && apt === null) apt = i + 1
  }
  return [rct, apt]
}

export interface TrialSummary { falseAlarms: number; eligible: number; detected: number; medianDelay: number | null }

export function runWorkshop(failure: Failure, w: number, c: number, r: number): TrialSummary[] {
  if (![128, 512, 1024, 2048].includes(w) || !Number.isInteger(c) || c < 2 || c > w + 1 ||
    !Number.isInteger(r) || r < 2 || r > 128) throw new Error('Invalid workshop settings')
  const result: TrialSummary[] = [0, 1].map(() => ({ falseAlarms: 0, eligible: 0, detected: 0, medianDelay: null }))
  const delays: number[][] = [[], []]
  for (let t = 0; t < TRIALS; t++) {
    const rand = makeTestRng(190026 + t)
    const bits = new Uint8Array(PREFIX + AFTER)
    for (let i = 0; i < bits.length; i++) {
      const u = rand(), fresh = rand() < 0.53 ? 1 : 0
      bits[i] = i < PREFIX ? fresh : failure === 'stuck' ? 1 : failure === 'alternating' ? i % 2 :
        failure === 'bias' ? (u < 0.65 ? 1 : 0) : (u < 0.85 ? bits[i - 1] : fresh)
    }
    firstAlarms(bits, w, c, r).forEach((at, i) => {
      if (at !== null && at <= PREFIX) result[i].falseAlarms++
      else {
        result[i].eligible++
        if (at !== null) { result[i].detected++; delays[i].push(at - PREFIX) }
      }
    })
  }
  delays.forEach((d, i) => {
    d.sort((a, b) => a - b)
    if (d.length) result[i].medianDelay = (d[Math.floor((d.length - 1) / 2)] + d[Math.floor(d.length / 2)]) / 2
  })
  return result
}
