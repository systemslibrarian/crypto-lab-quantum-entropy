import type { BitStream, VNPairStep, VNResult } from './types.ts'

/**
 * Von Neumann debiasing (von Neumann, 1951).
 *
 * Read non-overlapping pairs:  01 → emit 0,  10 → emit 1,  00/11 → discard.
 * For INDEPENDENT bits with any fixed bias p, P(01) = P(10) = p(1-p), so the
 * output is exactly unbiased — at the cost of throughput: only 2p(1-p) of
 * pairs survive, i.e. ~p(1-p) output bits per input bit.
 *
 * The procedure assumes independence. It does nothing about correlation
 * BETWEEN pairs: on a correlated stream the output still passes a bias check
 * while consecutive output bits remain mutually predictable.
 */
export function vonNeumann(bits: BitStream): VNResult {
  const steps: VNPairStep[] = []
  const out: number[] = []
  let discarded = 0
  const pairsRead = Math.floor(bits.length / 2)
  for (let i = 0; i + 1 < bits.length; i += 2) {
    const b1 = bits[i] as 0 | 1
    const b2 = bits[i + 1] as 0 | 1
    if (b1 === 0 && b2 === 1) {
      out.push(0)
      steps.push({ b1, b2, action: 'emit0' })
    } else if (b1 === 1 && b2 === 0) {
      out.push(1)
      steps.push({ b1, b2, action: 'emit1' })
    } else {
      discarded++
      steps.push({ b1, b2, action: 'discard' })
    }
  }
  return { output: Uint8Array.from(out), steps, pairsRead, discarded }
}
