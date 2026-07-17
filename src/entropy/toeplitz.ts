import type { BitStream, ToeplitzResult } from './types.ts'

/**
 * Toeplitz-matrix randomness extraction (2-universal hashing).
 *
 * An m×n binary Toeplitz matrix is fully determined by its first column and
 * first row — m+n-1 seed bits s, with T[i][j] = s[i - j + (n-1)]. The family
 * { x ↦ T·x over GF(2) } indexed by the seed is 2-universal: for any x ≠ y,
 * Pr_seed[Tx = Ty] ≤ 2^-m.
 *
 * Leftover Hash Lemma — ONE convention used everywhere in this repo:
 *   ε(k, m) = ½·√(2^(m-k))   (the bound on statistical distance from uniform)
 * Solved exactly for the output length: distance ≤ ε  ⟺  m ≤ k + 2 - 2·log₂(1/ε).
 * (The folk rule m ≤ k - 2·log₂(1/ε) is the same statement carrying an extra
 * 2-bit safety margin — it guarantees distance ≤ ε/2.)
 * The seed must be uniform and independent of the input — the extractor
 * spends true randomness to clean dirty randomness; it cannot create it.
 */

/** Real GF(2) matrix–vector multiply: output[i] = ⊕_j T[i][j]·x[j]. */
export function toeplitzExtract(input: BitStream, seed: BitStream, m: number): ToeplitzResult {
  const n = input.length
  if (!Number.isInteger(m) || m < 1) throw new Error(`output length m must be a positive integer, got ${m}`)
  if (n < 1) throw new Error('input must contain at least one bit')
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

/**
 * Largest output length whose LHL bound stays within the target distance ε,
 * under this repo's single convention: m ≤ k + 2 - 2·log₂(1/ε), so that
 * lhlEpsilon(k, m) ≤ ε exactly (no hidden ε/2 slack).
 */
export function maxOutputBitsFor(k: number, epsilon: number): number {
  if (!(k >= 0)) throw new Error(`min-entropy k must be ≥ 0, got ${k}`)
  if (!(epsilon > 0 && epsilon < 1)) throw new Error(`target distance must be in (0,1), got ${epsilon}`)
  return Math.max(0, Math.floor(k + 2 - 2 * Math.log2(1 / epsilon)))
}
