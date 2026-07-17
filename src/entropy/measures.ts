import type { BitStream } from './types.ts'

/**
 * Shannon entropy of a Bernoulli(p) bit, in bits/bit:
 *   H(p) = -p·log₂p - (1-p)·log₂(1-p)
 * The AVERAGE surprise — every outcome weighted by how often it occurs.
 */
export function shannonEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
}

/**
 * Min-entropy of a Bernoulli(p) bit, in bits/bit:
 *   H∞(p) = -log₂(max(p, 1-p))
 * The WORST CASE: an attacker who guesses the single most likely outcome,
 * once, is right with probability 2^(-H∞).
 */
export function minEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -Math.log2(Math.max(p, 1 - p))
}

/** Empirical P(bit = 1) of a stream. */
export function fractionOnes(bits: BitStream): number {
  if (bits.length === 0) return 0.5
  let ones = 0
  for (let i = 0; i < bits.length; i++) ones += bits[i]
  return ones / bits.length
}

/**
 * Accuracy of the optimal first-order Markov predictor: for each previous-bit
 * context, predict the more common successor. On an i.i.d. unbiased stream this
 * is ~50%; on a correlated stream it climbs even when the bias reads 50/50.
 * The per-bit conditional min-entropy the predictor faces is -log₂(accuracy).
 */
export function markovPredictorAccuracy(bits: BitStream): number {
  if (bits.length < 2) return 0.5
  // counts[prev][next]
  const counts = [
    [0, 0],
    [0, 0],
  ]
  for (let i = 1; i < bits.length; i++) counts[bits[i - 1]][bits[i]]++
  let correct = 0
  for (const prev of [0, 1]) correct += Math.max(counts[prev][0], counts[prev][1])
  return correct / (bits.length - 1)
}

/** Lag-1 sample autocorrelation of a bit stream (0 for i.i.d., → 1 for sticky). */
export function lag1Autocorrelation(bits: BitStream): number {
  const n = bits.length
  if (n < 2) return 0
  const mean = fractionOnes(bits)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const d = bits[i] - mean
    den += d * d
    if (i > 0) num += d * (bits[i - 1] - mean)
  }
  if (den === 0) return 0
  return num / den
}
