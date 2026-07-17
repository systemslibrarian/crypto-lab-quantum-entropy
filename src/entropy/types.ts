/** A bit stream is a Uint8Array whose entries are 0 or 1 (one bit per byte, for inspectability). */
export type BitStream = Uint8Array

/** Configuration of the modeled beam-splitter source. */
export interface SourceConfig {
  /** P(bit = 1) — detector-efficiency mismatch. 0.5 = perfectly balanced detectors. */
  pOne: number
  /**
   * Lag-1 correlation: with probability `persistence` the next bit repeats the
   * previous one (dead-time / afterpulsing model); otherwise a fresh Bernoulli(pOne)
   * draw. The marginal bias stays exactly pOne for any persistence.
   */
  persistence: number
  /** When set, that detector is stuck: the source emits only this value. */
  stuck: 0 | 1 | null
}

/** One von Neumann pair step, kept for the step-through animation. */
export interface VNPairStep {
  b1: 0 | 1
  b2: 0 | 1
  action: 'emit0' | 'emit1' | 'discard'
}

export interface VNResult {
  output: BitStream
  steps: VNPairStep[]
  pairsRead: number
  discarded: number
}

export interface ToeplitzResult {
  output: BitStream
  /** Rows of the Toeplitz matrix actually used (for visualization), row-major bits. */
  rows: BitStream[]
}

export interface RCTResult {
  /** Longest run of identical samples observed. */
  maxRun: number
  /** Index (0-based, into the stream) where the test first fired, or null if it never did. */
  failedAt: number | null
}

export interface APTResult {
  /** Highest count of the window's reference sample seen in any full window. */
  maxCount: number
  /** Index of the first window (0-based) that fired, or null. */
  failedWindow: number | null
  windowsTested: number
}
