import type { SourceConfig } from './types.ts'

/**
 * Exact block min-entropy of the CONFIGURED source model.
 *
 * The Leftover Hash Lemma needs a bound on the min-entropy of the extractor's
 * entire n-bit input distribution — not a statistic measured on one sample of
 * it. For this lab's repeat-or-fresh Markov model the bound is computable
 * exactly: find the single most likely n-bit path through the chain with a
 * max-product dynamic program, and set k = −log₂ P(most likely path).
 *
 * Model transition probabilities (persistence c, bias p):
 *   P(next = s | prev = s)  = c + (1−c)·P(fresh = s)
 *   P(next = s | prev = ¬s) = (1−c)·P(fresh = s)
 * with P(fresh = 1) = p and the first bit drawn fresh.
 *
 * Sanity anchors (proved in tests): c = 0 reduces to n·H∞(p); a stuck source
 * has a certain path, so k = 0.
 */
export function blockMinEntropy(n: number, cfg: SourceConfig): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`block length must be a positive integer, got ${n}`)
  const { pOne: p, persistence: c, stuck } = cfg
  if (!(p >= 0 && p <= 1)) throw new Error(`pOne must be in [0,1], got ${p}`)
  if (!(c >= 0 && c <= 1)) throw new Error(`persistence must be in [0,1], got ${c}`)
  if (stuck !== null) return 0 // the constant path has probability 1
  if (p === 0 || p === 1) return 0
  if (c === 1) {
    // after the first fresh bit the chain repeats forever: best path prob = max(p, 1−p)
    return -Math.log2(Math.max(p, 1 - p))
  }
  // log₂ transition matrix: t[prev][next]
  const t = [
    [Math.log2(c + (1 - c) * (1 - p)), Math.log2((1 - c) * p)],
    [Math.log2((1 - c) * (1 - p)), Math.log2(c + (1 - c) * p)],
  ]
  // L[s] = log₂ probability of the most likely length-i path ending in state s
  let L0 = Math.log2(1 - p)
  let L1 = Math.log2(p)
  for (let i = 1; i < n; i++) {
    const n0 = Math.max(L0 + t[0][0], L1 + t[1][0])
    const n1 = Math.max(L0 + t[0][1], L1 + t[1][1])
    L0 = n0
    L1 = n1
  }
  return -Math.max(L0, L1)
}

/** Per-sample min-entropy rate of the model over an n-bit block: k/n. */
export function blockMinEntropyRate(n: number, cfg: SourceConfig): number {
  return blockMinEntropy(n, cfg) / n
}
