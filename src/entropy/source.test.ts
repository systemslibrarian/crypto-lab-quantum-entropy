import { describe, expect, it } from 'vitest'
import { fractionOnes, lag1Autocorrelation } from './measures.ts'
import { generateBits, makeTestRng } from './source.ts'

describe('modeled beam-splitter source', () => {
  it('emits only 0s and 1s', () => {
    const bits = generateBits(1000, { pOne: 0.53, persistence: 0, stuck: null }, makeTestRng(1))
    for (const b of bits) expect(b === 0 || b === 1).toBe(true)
  })

  it('respects the bias knob (53/47 detector mismatch)', () => {
    const bits = generateBits(100_000, { pOne: 0.53, persistence: 0, stuck: null }, makeTestRng(2))
    expect(fractionOnes(bits)).toBeGreaterThan(0.52)
    expect(fractionOnes(bits)).toBeLessThan(0.54)
  })

  it('persistence adds correlation WITHOUT changing the marginal bias', () => {
    const bits = generateBits(100_000, { pOne: 0.6, persistence: 0.7, stuck: null }, makeTestRng(5))
    expect(fractionOnes(bits)).toBeGreaterThan(0.58)
    expect(fractionOnes(bits)).toBeLessThan(0.62)
    expect(lag1Autocorrelation(bits)).toBeGreaterThan(0.6)
  })

  it('a stuck detector emits a constant', () => {
    expect(generateBits(64, { pOne: 0.5, persistence: 0, stuck: 1 }, makeTestRng(1))).toEqual(
      new Uint8Array(64).fill(1),
    )
    expect(generateBits(64, { pOne: 0.5, persistence: 0, stuck: 0 }, makeTestRng(1))).toEqual(
      new Uint8Array(64),
    )
  })

  it('is deterministic under an injected RNG (reproducible tests)', () => {
    const a = generateBits(256, { pOne: 0.53, persistence: 0.2, stuck: null }, makeTestRng(42))
    const b = generateBits(256, { pOne: 0.53, persistence: 0.2, stuck: null }, makeTestRng(42))
    expect(a).toEqual(b)
  })
})
