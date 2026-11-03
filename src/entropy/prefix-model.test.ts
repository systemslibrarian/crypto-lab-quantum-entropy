import { describe, expect, it } from 'vitest'
import { prefixModel } from './prefix-model.ts'

describe('public-prefix distribution', () => {
  it('agrees with an exhaustive probability distribution, including both endpoints', () => {
    for (let n = 1; n <= 8; n++) {
      for (let d = 0; d <= n; d++) {
        const probabilities = Array.from({ length: 2 ** n }, (_, x) =>
          x < 2 ** (n - d) ? 1 / 2 ** (n - d) : 0)
        const distance = probabilities.reduce((sum, p) => sum + Math.abs(p - 1 / 2 ** n), 0) / 2
        const model = prefixModel(n, d)
        expect(model.distance).toBe(distance)
        expect(model.minEntropy).toBeCloseTo(-Math.log2(Math.max(...probabilities)), 12)
      }
    }
  })
  it('has 99% entropy rate but distance 1023/1024 at the teaching preset', () => {
    expect(prefixModel(1000, 10)).toEqual({
      minEntropy: 990, rate: 0.99, uniformPrefixProbability: 1 / 1024, distance: 1023 / 1024,
    })
  })
  it('rejects invalid model dimensions', () => {
    for (const [n, d] of [[0, 0], [4, -1], [4, 5], [4, 0.5], [NaN, 1]]) {
      expect(() => prefixModel(n, d)).toThrow(RangeError)
    }
  })
})
