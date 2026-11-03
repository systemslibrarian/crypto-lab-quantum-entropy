import { describe, expect, it } from 'vitest'
import { kdfBound, type KdfModel } from './kdf-bounds'
const base: KdfModel = { n: 256, k: 128, m: 128, b: 64, independence: 65, game: 'unpredictability', seed: 'independent-uniform', family: 'independent', hypothetical: true }
describe('restricted KDF bounds', () => {
  it('matches both published examples', () => {
    expect(kdfBound(base)).toMatchObject({ supported: true, route: 'no-loss', bound: 65 / 18446744073709551616, requiredIndependence: 65 })
    expect(kdfBound({ ...base, k: 138, independence: 70 })).toMatchObject({ supported: true, route: 'small-loss', bound: 3 / 18446744073709551616, requiredIndependence: 70 })
  })
  it.each([
    { n: 127 }, { k: 127 }, { k: 129 }, { k: 137 }, { independence: 64 },
    { n: NaN }, { k: Infinity }, { m: 1.5 }, { m: 0 }, { n: 65537 },
    { b: 5 }, { b: 257 }, { b: 64.5 }, { b: NaN },
    { game: 'indistinguishability' }, { game: 'unknown' }, { seed: 'other' }, { seed: 'unknown' },
    { family: 'hkdf' }, { family: 'unknown' }, { hypothetical: false }, { k: 138, independence: 69 },
  ])('refuses unsupported assumptions %j without returning a number', change => {
    const result = kdfBound({ ...base, ...change })
    expect(result.supported).toBe(false)
    expect(result).not.toHaveProperty('bound')
    expect(result).toHaveProperty('reason')
  })
  it('rounds the entropy threshold up at a power-of-two boundary', () => {
    expect(kdfBound({ ...base, b: 65, k: 138, independence: 71 }).supported).toBe(false)
    expect(kdfBound({ ...base, b: 65, k: 139, independence: 71 })).toMatchObject({ supported: true, minimumSmallLossEntropy: 139 })
  })
  it('independently certifies both forward tail inequalities with exact integer arithmetic for every offered exponent', () => {
    for (let b = 6; b <= 256; b++) {
      const B = BigInt(b)
      // e < 11/4: (e/b)^b <= 2^-b, compared after clearing denominators.
      expect(11n ** B * 2n ** B <= (4n * B) ** B).toBe(true)
      let gap = 4, u = 16n
      while (u < 16n * B) { gap++; u *= 2n }
      const q = BigInt(b + 3 + ((b + 3) % 2))
      expect(q + 1n <= B + 6n).toBe(true)
      // Lemma 4.4: 8*((q*u+q*q)/(u-1)^2)^(q/2) <= 2^-b.
      expect(8n * (q * u + q * q) ** (q / 2n) * 2n ** B <= (u - 1n) ** q).toBe(true)
      expect(kdfBound({ ...base, b, independence: b + 1 })).toMatchObject({ supported: true, route: 'no-loss' })
      expect(kdfBound({ ...base, b, k: 128 + gap, independence: b + 6 })).toMatchObject({ supported: true, minimumSmallLossEntropy: 128 + gap })
      expect(kdfBound({ ...base, b, k: 127 + gap, independence: b + 6 }).supported).toBe(false)
    }
  })
})
