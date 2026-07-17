import { describe, expect, it } from 'vitest'
import { blockMinEntropy, blockMinEntropyRate } from './blockentropy.ts'
import { minEntropy } from './measures.ts'
import type { SourceConfig } from './types.ts'

function cfg(pOne: number, persistence: number, stuck: 0 | 1 | null = null): SourceConfig {
  return { pOne, persistence, stuck }
}

/** Independent oracle: enumerate all 2^n sequences and take the true max path probability. */
function bruteForceBlockMinEntropy(n: number, p: number, c: number): number {
  let maxProb = 0
  for (let v = 0; v < 1 << n; v++) {
    let prob = 1
    let prev = -1
    for (let i = 0; i < n; i++) {
      const bit = (v >> i) & 1
      const fresh = bit === 1 ? p : 1 - p
      prob *= prev === -1 ? fresh : (prev === bit ? c : 0) + (1 - c) * fresh
      prev = bit
    }
    if (prob > maxProb) maxProb = prob
  }
  return -Math.log2(maxProb)
}

describe('model block min-entropy (max-path dynamic program)', () => {
  it('ORACLE: equals exhaustive enumeration for all small blocks across a parameter grid', () => {
    for (const n of [1, 2, 3, 5, 8, 10]) {
      for (const p of [0.1, 0.47, 0.5, 0.53, 0.65, 0.9]) {
        for (const c of [0, 0.2, 0.5, 0.8, 0.95]) {
          expect(blockMinEntropy(n, cfg(p, c))).toBeCloseTo(bruteForceBlockMinEntropy(n, p, c), 9)
        }
      }
    }
  })

  it('reduces to n·H∞(p) when persistence is zero (the i.i.d. case)', () => {
    expect(blockMinEntropy(256, cfg(0.53, 0))).toBeCloseTo(256 * minEntropy(0.53), 9)
    expect(blockMinEntropy(256, cfg(0.5, 0))).toBeCloseTo(256, 9)
  })

  it('is zero for a stuck source — a certain path carries no entropy', () => {
    expect(blockMinEntropy(256, cfg(0.5, 0, 1))).toBe(0)
    expect(blockMinEntropy(256, cfg(0.5, 0, 0))).toBe(0)
  })

  it('is zero for a deterministic bias, and max(p,1−p) path at full persistence', () => {
    expect(blockMinEntropy(64, cfg(1, 0))).toBe(0)
    expect(blockMinEntropy(64, cfg(0, 0.3))).toBe(0)
    expect(blockMinEntropy(64, cfg(0.53, 1))).toBeCloseTo(minEntropy(0.53), 12)
  })

  it('correlation strictly cuts the block bound below the bias-only bound', () => {
    const iid = blockMinEntropy(256, cfg(0.53, 0))
    const sticky = blockMinEntropy(256, cfg(0.53, 0.8))
    expect(sticky).toBeLessThan(iid * 0.5) // the sticky path is FAR more likely
    expect(sticky).toBeGreaterThan(0)
  })

  it('rate is monotone non-increasing in persistence at fixed bias', () => {
    let prev = Infinity
    for (const c of [0, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const rate = blockMinEntropyRate(256, cfg(0.53, c))
      expect(rate).toBeLessThanOrEqual(prev + 1e-12)
      prev = rate
    }
  })

  it('rejects invalid domains (fail closed)', () => {
    expect(() => blockMinEntropy(0, cfg(0.5, 0))).toThrow(/positive integer/)
    expect(() => blockMinEntropy(2.5, cfg(0.5, 0))).toThrow(/positive integer/)
    expect(() => blockMinEntropy(8, cfg(-0.1, 0))).toThrow(/pOne/)
    expect(() => blockMinEntropy(8, cfg(0.5, 1.1))).toThrow(/persistence/)
  })
})
