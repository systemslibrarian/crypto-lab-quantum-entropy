import { expect, it } from 'vitest'
import { aptWindowProbability, firstAlarms, runWorkshop } from './health-workshop.ts'
import { runAPT, runRCT } from './healthtests.ts'

it('reference-aware probability agrees with exhaustive enumeration of every short IID sequence', () => {
  for (const p of [0.2, 0.5, 0.73]) for (let c = 2; c <= 7; c++) {
    let exact = 0
    for (let mask = 0; mask < 64; mask++) {
      const bits = Uint8Array.from({ length: 6 }, (_, i) => (mask >> i) & 1)
      const prob = bits.reduce((v, b) => v * (b ? p : 1 - p), 1)
      if (runAPT(bits, c, 6).failedWindow !== null) exact += prob
    }
    expect(aptWindowProbability(6, c, p)).toBeCloseTo(exact, 13)
  }
})
it('counts the sample that reaches a threshold, including partial windows', () => {
  const bits = new Uint8Array(50).fill(1)
  expect(firstAlarms(bits, 128, 30, 21)).toEqual([21, 30])
  expect(runRCT(bits, 21).failedAt).toBe(20)
})
it('separates pre-failure false alarms, detections and missed failures', () => {
  for (const s of runWorkshop('stuck', 1024, 600, 23)) {
    expect(s.falseAlarms + s.eligible).toBe(64)
    expect(s.detected).toBe(s.eligible)
    expect(s.medianDelay).toBeGreaterThan(0)
  }
  for (const s of runWorkshop('alternating', 1024, 600, 23)) expect(s.detected).toBe(0)
})
it('lower thresholds cannot delay detection or reduce alarms on the same stream', () => {
  const bits = Uint8Array.from({length: 4096}, (_, i) => i % 17 < 12 ? 1 : 0)
  const loose = firstAlarms(bits, 128, 95, 20), sensitive = firstAlarms(bits, 128, 85, 10)
  for (let i = 0; i < 2; i++) expect(sensitive[i] ?? Infinity).toBeLessThanOrEqual(loose[i] ?? Infinity)
})
