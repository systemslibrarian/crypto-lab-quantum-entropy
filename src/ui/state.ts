import { blockMinEntropyRate } from '../entropy/blockentropy.ts'
import { APTMonitor, aptCutoff, RCTMonitor, rctCutoff } from '../entropy/healthtests.ts'
import { generateBits } from '../entropy/source.ts'
import type { BitStream, SourceConfig } from '../entropy/types.ts'

/** One shared raw stream: every panel measures/consumes the SAME bits. */
export const STREAM_LEN = 4096

/** Block length the extractor consumes; also the basis for model entropy rates. */
export const BLOCK_LEN = 256

/**
 * Continuous health-test state (SP 800-90B style): the claimed per-sample
 * min-entropy is fixed at COMMISSIONING time, the cutoffs derive from that
 * claim, monitor state persists across emissions, and an alarm LATCHES —
 * while latched, no material may reach the extractor. Changing the claim is
 * a commissioning action (operator resets the device), never something a
 * running source does for itself.
 */
export interface HealthState {
  claimedH: number
  rct: RCTMonitor
  apt: APTMonitor
  latched: boolean
}

export interface LabState {
  cfg: SourceConfig
  raw: BitStream
  health: HealthState
}

/** Conservative per-sample claim from the configured model: floor to 3 decimals. */
export function modelClaimFor(cfg: SourceConfig): number {
  return Math.floor(blockMinEntropyRate(BLOCK_LEN, cfg) * 1000) / 1000
}

const DEFAULT_CFG: SourceConfig = { pOne: 0.53, persistence: 0, stuck: null }

function freshHealth(claimedH: number): HealthState {
  return {
    claimedH,
    rct: new RCTMonitor(rctCutoff(claimedH)),
    apt: new APTMonitor(aptCutoff(claimedH)),
    latched: false,
  }
}

export const state: LabState = {
  cfg: { ...DEFAULT_CFG },
  raw: new Uint8Array(0),
  // commissioned out of the box for the default 53/47 device
  health: freshHealth(modelClaimFor(DEFAULT_CFG)),
}

type Listener = (s: LabState) => void
const listeners: Listener[] = []

export function subscribe(fn: Listener): void {
  listeners.push(fn)
}

function emit(): void {
  for (const fn of listeners) fn(state)
}

export function regenerate(): void {
  state.raw = generateBits(STREAM_LEN, state.cfg)
  const { rct, apt } = state.health
  rct.feed(state.raw)
  apt.feed(state.raw)
  if (rct.alarmed || apt.alarmed) state.health.latched = true
  emit()
}

export function setConfig(patch: Partial<SourceConfig>): void {
  Object.assign(state.cfg, patch)
  regenerate()
}

/**
 * Operator action: reset the alarm and set the entropy claim from the CURRENT
 * model bound, with fresh cutoffs and fresh monitor state. Refuses to
 * commission a source whose model carries (almost) no entropy — you cannot
 * paper over a dead device by re-declaring it.
 */
export function recommission(): boolean {
  const claim = modelClaimFor(state.cfg)
  if (claim < 0.01) return false
  state.health = freshHealth(claim)
  state.health.rct.feed(state.raw)
  state.health.apt.feed(state.raw)
  if (state.health.rct.alarmed || state.health.apt.alarmed) state.health.latched = true
  emit()
  return true
}
