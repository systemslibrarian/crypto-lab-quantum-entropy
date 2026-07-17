import { describe, expect, it } from 'vitest'
import { APT_WINDOW, aptCutoff, critBinom, rctCutoff, runAPT, runRCT } from './healthtests.ts'
import { generateBits, makeTestRng } from './source.ts'

describe('SP 800-90B §4.4.1 Repetition Count Test', () => {
  it('KAT: the spec worked example — H = 7.3 → C = 1 + ⌈20/7.3⌉ = 4', () => {
    expect(rctCutoff(7.3)).toBe(4)
  })

  it('KAT: full-entropy binary source H = 1 → C = 21', () => {
    expect(rctCutoff(1)).toBe(21)
  })

  it('fires on a stuck detector exactly when the run reaches the cutoff', () => {
    const stuck = new Uint8Array(100).fill(1)
    const { failedAt, maxRun } = runRCT(stuck, 21)
    expect(failedAt).toBe(20) // 21st identical sample, 0-indexed
    expect(maxRun).toBe(100)
  })

  it('does not fire on a healthy full-entropy stream', () => {
    const bits = generateBits(100_000, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(13))
    expect(runRCT(bits, rctCutoff(1)).failedAt).toBeNull()
  })

  it('a run one short of the cutoff passes', () => {
    const bits = Uint8Array.from([...Array(20).fill(1), 0])
    expect(runRCT(bits, 21).failedAt).toBeNull()
  })
})

describe('SP 800-90B §4.4.2 Adaptive Proportion Test', () => {
  it('KAT: binary window W = 1024, H = 1 → C = 589 (1 + critbinom(1024, 1/2, 1-2^-20))', () => {
    expect(aptCutoff(1)).toBe(589)
  })

  it('critBinom sanity: small exact case — Binom(4, 1/2) needs x = 4 to reach 1-2^-20', () => {
    // CDF hits 15/16 at x=3; only x=4 reaches ≥ 1 - 2^-20
    expect(critBinom(4, 0.5, 1 - Math.pow(2, -20))).toBe(4)
    expect(critBinom(4, 0.5, 0.9)).toBe(3)
  })

  it('fires on a stuck source in the very first window', () => {
    const stuck = new Uint8Array(APT_WINDOW).fill(0)
    const { failedWindow, maxCount } = runAPT(stuck, aptCutoff(1))
    expect(failedWindow).toBe(0)
    expect(maxCount).toBe(APT_WINDOW)
  })

  it('does not fire on a healthy full-entropy stream', () => {
    const bits = generateBits(
      APT_WINDOW * 40,
      { pOne: 0.5, persistence: 0, stuck: null },
      makeTestRng(17),
    )
    const { failedWindow, windowsTested } = runAPT(bits, aptCutoff(1))
    expect(windowsTested).toBe(40)
    expect(failedWindow).toBeNull()
  })

  it('catches a degraded (not fully stuck) source that the RCT misses', () => {
    // 65/35 bias with H claimed at 1: runs stay short of 21, but the window
    // proportion (~666/1024) blows past the 589 cutoff
    const bits = generateBits(
      APT_WINDOW * 2,
      { pOne: 0.65, persistence: 0, stuck: null },
      makeTestRng(19),
    )
    expect(runRCT(bits, rctCutoff(1)).failedAt).toBeNull()
    expect(runAPT(bits, aptCutoff(1)).failedWindow).not.toBeNull()
  })
})
