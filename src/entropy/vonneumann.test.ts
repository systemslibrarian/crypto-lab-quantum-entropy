import { describe, expect, it } from 'vitest'
import { fractionOnes, markovPredictorAccuracy } from './measures.ts'
import { generateBits, makeTestRng } from './source.ts'
import { vonNeumann } from './vonneumann.ts'

describe('von Neumann debiasing', () => {
  it('KAT: the 1951 procedure — 01→0, 10→1, 00/11→discard', () => {
    //            pairs: 01    10    00    11    01
    const input = Uint8Array.from([0, 1, 1, 0, 0, 0, 1, 1, 0, 1])
    const { output, steps, pairsRead, discarded } = vonNeumann(input)
    expect(Array.from(output)).toEqual([0, 1, 0])
    expect(pairsRead).toBe(5)
    expect(discarded).toBe(2)
    expect(steps.map((s) => s.action)).toEqual(['emit0', 'emit1', 'discard', 'discard', 'emit0'])
  })

  it('drops a trailing odd bit', () => {
    const { output, pairsRead } = vonNeumann(Uint8Array.from([0, 1, 1]))
    expect(Array.from(output)).toEqual([0])
    expect(pairsRead).toBe(1)
  })

  it('exactly unbiases an INDEPENDENT biased stream', () => {
    const bits = generateBits(200_000, { pOne: 0.7, persistence: 0, stuck: null }, makeTestRng(9))
    const { output } = vonNeumann(bits)
    expect(Math.abs(fractionOnes(output) - 0.5)).toBeLessThan(0.01)
  })

  it('throughput collapses to ~p(1-p) output bits per input bit', () => {
    const p = 0.7
    const bits = generateBits(200_000, { pOne: p, persistence: 0, stuck: null }, makeTestRng(9))
    const { output } = vonNeumann(bits)
    const rate = output.length / bits.length
    expect(rate).toBeGreaterThan(p * (1 - p) - 0.01) // 0.21 expected
    expect(rate).toBeLessThan(p * (1 - p) + 0.01)
  })

  it('THE HONEST LIMIT: on a correlated stream the bias check passes but the output stays predictable', () => {
    const bits = generateBits(
      200_000,
      { pOne: 0.5, persistence: 0.8, stuck: null },
      makeTestRng(11),
    )
    const { output } = vonNeumann(bits)
    // the debiaser "claims success" — output reads ~50/50…
    expect(Math.abs(fractionOnes(output) - 0.5)).toBeLessThan(0.02)
    // …but a trivial predictor still beats coin-flipping on it
    expect(markovPredictorAccuracy(output)).toBeGreaterThan(0.6)
  })
})
