import type { BitStream, SourceConfig } from './types.ts'

/**
 * Modeled beam-splitter QRNG.
 *
 * This is a MODEL of the physics (a photon hitting detector A or B), not real
 * quantum hardware: the underlying randomness comes from the browser's CSPRNG.
 * Everything downstream of the raw stream — the entropy measurements, the
 * debiaser, the extractor, the health tests — operates on these bits for real.
 *
 * The model: each photon lands on detector B (bit = 1) with probability pOne
 * (detector-efficiency mismatch), and with probability `persistence` the
 * output simply repeats its last bit (a repeat-or-fresh Markov model — a
 * deliberately simple stand-in for correlation effects; real afterpulsing and
 * dead-time physics behave differently). This introduces lag-1 correlation
 * while leaving the marginal bias at exactly pOne.
 */
export function generateBits(
  n: number,
  cfg: SourceConfig,
  random: () => number = cryptoRandom,
): BitStream {
  const out = new Uint8Array(n)
  if (cfg.stuck !== null) {
    out.fill(cfg.stuck)
    return out
  }
  let prev: 0 | 1 = random() < cfg.pOne ? 1 : 0
  out[0] = prev
  for (let i = 1; i < n; i++) {
    if (random() < cfg.persistence) {
      out[i] = prev
    } else {
      prev = random() < cfg.pOne ? 1 : 0
      out[i] = prev
    }
    prev = out[i] as 0 | 1
  }
  return out
}

/** Uniform float in [0, 1) from the browser CSPRNG (53-bit precision). */
export function cryptoRandom(): number {
  const buf = new Uint32Array(2)
  crypto.getRandomValues(buf)
  // 21 high bits + 32 low bits = 53 bits of mantissa
  return ((buf[0] >>> 11) * 4294967296 + buf[1]) / 9007199254740992
}

/** Deterministic xorshift128 RNG for reproducible tests — never used by the UI. */
export function makeTestRng(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9
  let y = 0x243f6a88
  let z = 0xb7e15162
  let w = 0xdeadbeef
  return () => {
    const t = x ^ (x << 11)
    x = y
    y = z
    z = w
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0
    return w / 4294967296
  }
}
