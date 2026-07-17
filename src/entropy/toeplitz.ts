import type { BitStream, ToeplitzResult } from './types.ts'

/**
 * Toeplitz-matrix randomness extraction (2-universal hashing).
 *
 * An m×n binary Toeplitz matrix is fully determined by its first column and
 * first row — m+n-1 seed bits s, with T[i][j] = s[i - j + (n-1)]. The family
 * { x ↦ T·x over GF(2) } indexed by the seed is 2-universal: for any x ≠ y,
 * Pr_seed[Tx = Ty] ≤ 2^-m.
 *
 * Leftover Hash Lemma: if the input has min-entropy k, the m-bit output is
 * within statistical distance ε ≤ ½·√(2^(m-k)) of uniform (given the seed).
 * Equivalently: choosing m ≤ k - 2·log₂(1/ε) guarantees distance ≤ ε/2.
 * The seed must be uniform and independent of the input — the extractor
 * spends true randomness to clean dirty randomness; it cannot create it.
 */

/** Real GF(2) matrix–vector multiply: output[i] = ⊕_j T[i][j]·x[j]. */
export function toeplitzExtract(input: BitStream, seed: BitStream, m: number): ToeplitzResult {
  const n = input.length
  if (seed.length !== m + n - 1) {
    throw new Error(`Toeplitz seed must be m+n-1 = ${m + n - 1} bits, got ${seed.length}`)
  }
  const output = new Uint8Array(m)
  const rows: BitStream[] = []
  for (let i = 0; i < m; i++) {
    const row = new Uint8Array(n)
    let acc = 0
    for (let j = 0; j < n; j++) {
      const bit = seed[i - j + (n - 1)]
      row[j] = bit
      acc ^= bit & input[j]
    }
    output[i] = acc
    rows.push(row)
  }
  return { output, rows }
}

/**
 * Leftover Hash Lemma statistical-distance bound for extracting m bits from
 * min-entropy k: ε ≤ ½·√(2^(m-k)). Values ≥ 1 mean the bound is vacuous —
 * the output carries no uniformity guarantee at all.
 */
export function lhlEpsilon(k: number, m: number): number {
  return 0.5 * Math.pow(2, (m - k) / 2)
}

/** Largest safe output length m ≤ k - 2·log₂(1/ε) for a target distance ε. */
export function maxSafeOutputBits(k: number, epsilon: number): number {
  return Math.max(0, Math.floor(k - 2 * Math.log2(1 / epsilon)))
}
