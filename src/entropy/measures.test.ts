import { describe, expect, it } from 'vitest'
import {
  fractionOnes,
  lag1Autocorrelation,
  markovPredictorAccuracy,
  minEntropy,
  shannonEntropy,
} from './measures.ts'
import { generateBits, makeTestRng } from './source.ts'

describe('Shannon vs min-entropy (spec KATs)', () => {
  it('KAT: p = 0.53 — the brief headline numbers', () => {
    // Shannon reads "99.7% random"; min-entropy says an optimal guesser faces only 0.9159 bits
    expect(shannonEntropy(0.53)).toBeCloseTo(0.9974, 4)
    expect(minEntropy(0.53)).toBeCloseTo(0.9159, 4)
  })

  it('KAT: p = 0.5 — a perfect coin has 1 bit of both', () => {
    expect(shannonEntropy(0.5)).toBe(1)
    expect(minEntropy(0.5)).toBe(1)
  })

  it('KAT: p = 0.75 — the gap widens as bias grows', () => {
    expect(shannonEntropy(0.75)).toBeCloseTo(0.811278, 6)
    expect(minEntropy(0.75)).toBeCloseTo(0.415037, 6)
  })

  it('min-entropy is never above Shannon entropy', () => {
    for (let p = 0.01; p < 1; p += 0.01) {
      expect(minEntropy(p)).toBeLessThanOrEqual(shannonEntropy(p) + 1e-12)
    }
  })

  it('degenerate sources have zero entropy of either kind', () => {
    expect(shannonEntropy(0)).toBe(0)
    expect(shannonEntropy(1)).toBe(0)
    expect(minEntropy(0)).toBe(0)
    expect(minEntropy(1)).toBe(0)
  })
})

describe('empirical measurements', () => {
  it('fractionOnes counts exactly', () => {
    expect(fractionOnes(Uint8Array.from([1, 1, 0, 1]))).toBe(0.75)
    expect(fractionOnes(new Uint8Array(0))).toBe(0.5)
  })

  it('Markov predictor is ~50% on an i.i.d. unbiased stream', () => {
    const bits = generateBits(50_000, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(7))
    expect(markovPredictorAccuracy(bits)).toBeGreaterThan(0.48)
    expect(markovPredictorAccuracy(bits)).toBeLessThan(0.52)
  })

  it('Markov predictor wins big on a correlated stream even at 50/50 bias', () => {
    const bits = generateBits(50_000, { pOne: 0.5, persistence: 0.8, stuck: null }, makeTestRng(7))
    expect(Math.abs(fractionOnes(bits) - 0.5)).toBeLessThan(0.03) // bias looks fine…
    expect(markovPredictorAccuracy(bits)).toBeGreaterThan(0.85) // …but every bit is guessable
  })

  it('lag-1 autocorrelation tracks the persistence knob', () => {
    const iid = generateBits(50_000, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(3))
    expect(Math.abs(lag1Autocorrelation(iid))).toBeLessThan(0.03)
    const sticky = generateBits(50_000, { pOne: 0.5, persistence: 0.6, stuck: null }, makeTestRng(3))
    expect(lag1Autocorrelation(sticky)).toBeGreaterThan(0.5)
  })
})
