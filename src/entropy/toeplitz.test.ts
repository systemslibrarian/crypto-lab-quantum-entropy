import { describe, expect, it } from 'vitest'
import { generateBits, makeTestRng } from './source.ts'
import { lhlEpsilon, maxOutputBitsFor, toeplitzExtract } from './toeplitz.ts'

describe('Toeplitz extraction (2-universal hashing)', () => {
  it('KAT: 4×4 matrix from seed 1011001, input 1101 → output 1110', () => {
    const seed = Uint8Array.from([1, 0, 1, 1, 0, 0, 1]) // m+n-1 = 7 bits
    const input = Uint8Array.from([1, 1, 0, 1])
    const { output, rows } = toeplitzExtract(input, seed, 4)
    expect(Array.from(output)).toEqual([1, 1, 1, 0])
    // Toeplitz structure: each row is the previous one shifted right
    expect(rows.map((r) => Array.from(r).join(''))).toEqual(['1101', '0110', '0011', '1001'])
  })

  it('rejects a wrong-length seed (fail closed, no silent truncation)', () => {
    expect(() => toeplitzExtract(new Uint8Array(8), new Uint8Array(10), 4)).toThrow(/m\+n-1/)
  })

  it('is GF(2)-linear: T(x⊕y) = T(x)⊕T(y)', () => {
    const rng = makeTestRng(21)
    const n = 64
    const m = 32
    const seed = generateBits(m + n - 1, { pOne: 0.5, persistence: 0, stuck: null }, rng)
    const x = generateBits(n, { pOne: 0.5, persistence: 0, stuck: null }, rng)
    const y = generateBits(n, { pOne: 0.5, persistence: 0, stuck: null }, rng)
    const xy = x.map((b, i) => b ^ y[i])
    const tx = toeplitzExtract(x, seed, m).output
    const ty = toeplitzExtract(y, seed, m).output
    const txy = toeplitzExtract(xy, seed, m).output
    expect(Array.from(txy)).toEqual(Array.from(tx).map((b, i) => b ^ ty[i]))
  })

  it('is 2-universal: over ALL 32 seeds (m=n=3), every pair x≠y collides ≤ 2^-m of the time', () => {
    const m = 3
    const n = 3
    const toBits = (v: number, len: number) =>
      Uint8Array.from({ length: len }, (_, i) => (v >> (len - 1 - i)) & 1)
    for (let xv = 0; xv < 8; xv++) {
      for (let yv = xv + 1; yv < 8; yv++) {
        let collisions = 0
        for (let sv = 0; sv < 32; sv++) {
          const seed = toBits(sv, m + n - 1)
          const ox = toeplitzExtract(toBits(xv, n), seed, m).output.join('')
          const oy = toeplitzExtract(toBits(yv, n), seed, m).output.join('')
          if (ox === oy) collisions++
        }
        expect(collisions).toBeLessThanOrEqual(32 * Math.pow(2, -m)) // ≤ 4 of 32 seeds
      }
    }
  })

  it('Leftover Hash Lemma accounting: ε ≤ ½·√(2^(m-k))', () => {
    expect(lhlEpsilon(256, 256)).toBe(0.5) // m = k: no margin at all
    expect(lhlEpsilon(256, 196)).toBeCloseTo(0.5 * Math.pow(2, -30), 15) // 60-bit margin
    expect(lhlEpsilon(100, 200)).toBeGreaterThan(1) // m > k: bound is vacuous
  })

  it('m ≤ k + 2 - 2·log₂(1/ε): the exact solve of the displayed bound, one convention throughout', () => {
    expect(maxOutputBitsFor(468, Math.pow(2, -64))).toBe(342) // 468 + 2 - 128
    expect(maxOutputBitsFor(100, Math.pow(2, -64))).toBe(0) // not enough entropy for ANY safe bit
    // the returned m honors the target, and one more bit always violates it
    for (const [k, eps] of [
      [468, Math.pow(2, -64)],
      [234.5, Math.pow(2, -32)],
      [50.3, 0.01],
    ] as const) {
      const m = maxOutputBitsFor(k, eps)
      if (m > 0) expect(lhlEpsilon(k, m)).toBeLessThanOrEqual(eps)
      expect(lhlEpsilon(k, m + 1)).toBeGreaterThan(eps)
    }
    expect(() => maxOutputBitsFor(-1, 0.5)).toThrow(/≥ 0/)
    expect(() => maxOutputBitsFor(100, 0)).toThrow(/\(0,1\)/)
    expect(() => maxOutputBitsFor(100, 1)).toThrow(/\(0,1\)/)
  })
})
