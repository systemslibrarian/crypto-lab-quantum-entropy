import { describe, expect, it } from 'vitest'
import {
  APT_WINDOW,
  APTMonitor,
  aptCutoff,
  critBinom,
  RCTMonitor,
  rctCutoff,
  runAPT,
  runRCT,
} from './healthtests.ts'
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

describe('stateful monitors — run/window state must survive any chunking', () => {
  // A stream whose only failure (a 21-run) straddles position 1000
  function failingStream(): Uint8Array {
    const bits = generateBits(2048, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(23))
    for (let i = 990; i < 1011; i++) bits[i] = 1
    // ensure the run is exactly 21, bounded by 0s
    bits[989] = 0
    bits[1011] = 0
    return bits
  }

  it('RCT alarms at the identical absolute sample for EVERY possible chunk split', () => {
    const bits = failingStream()
    const whole = new RCTMonitor(21)
    whole.feed(bits)
    expect(whole.failedAt).toBe(1010) // 21st bit of the run, 0-indexed lifetime position
    for (let split = 0; split <= bits.length; split += 64) {
      const m = new RCTMonitor(21)
      m.feed(bits.subarray(0, split))
      m.feed(bits.subarray(split))
      expect(m.failedAt).toBe(whole.failedAt)
      expect(m.maxRun).toBe(whole.maxRun)
    }
    // exhaustive around the failure itself
    for (let split = 985; split <= 1015; split++) {
      const m = new RCTMonitor(21)
      m.feed(bits.subarray(0, split))
      m.feed(bits.subarray(split))
      expect(m.failedAt).toBe(whole.failedAt)
    }
  })

  it('APT window state carries across chunks: same alarm window at every split', () => {
    // stuck stream: first full window alarms
    const bits = new Uint8Array(APT_WINDOW + 512).fill(0)
    const whole = new APTMonitor(589)
    whole.feed(bits)
    expect(whole.failedWindow).toBe(0)
    for (const split of [1, 100, 588, 589, 1000, 1024, 1500]) {
      const m = new APTMonitor(589)
      m.feed(bits.subarray(0, split))
      m.feed(bits.subarray(split))
      expect(m.failedWindow).toBe(0)
    }
  })

  it('a batch reset every 4,096 bits misses what the continuous monitor catches', () => {
    // 20 identical bits at the end of chunk A + 10 at the start of chunk B: a 30-run
    const a = generateBits(4096, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(29))
    const b = generateBits(4096, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(31))
    for (let i = 4076; i < 4096; i++) a[i] = 1
    a[4075] = 0
    for (let i = 0; i < 10; i++) b[i] = 1
    b[10] = 0
    // per-chunk batch evaluation sees runs of only 20 and 10 — no alarm
    expect(runRCT(a, 21).failedAt).toBeNull()
    expect(runRCT(b, 21).failedAt).toBeNull()
    // the continuous monitor sees the 30-run across the boundary and alarms
    const m = new RCTMonitor(21)
    m.feed(a)
    m.feed(b)
    expect(m.alarmed).toBe(true)
    expect(m.failedAt).toBe(4096) // 21st bit of the run: 20 in chunk A + 1st of chunk B
  })

  it('the alarm latches: healthy bits after a failure do not clear it', () => {
    const m = new RCTMonitor(21)
    m.feed(new Uint8Array(64).fill(1))
    expect(m.alarmed).toBe(true)
    m.feed(generateBits(4096, { pOne: 0.5, persistence: 0, stuck: null }, makeTestRng(37)))
    expect(m.alarmed).toBe(true)
    expect(m.failedAt).toBe(20)
  })

  it('rejects invalid cutoffs and windows (fail closed)', () => {
    expect(() => new RCTMonitor(1)).toThrow(/≥ 2/)
    expect(() => new APTMonitor(589, 1)).toThrow(/≥ 2/)
    expect(() => rctCutoff(0)).toThrow(/positive/)
    expect(() => rctCutoff(-1)).toThrow(/positive/)
    expect(() => aptCutoff(0)).toThrow(/positive/)
  })
})
