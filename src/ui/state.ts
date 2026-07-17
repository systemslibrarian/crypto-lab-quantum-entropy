import { generateBits } from '../entropy/source.ts'
import type { BitStream, SourceConfig } from '../entropy/types.ts'

/** One shared raw stream: every panel measures/consumes the SAME bits. */
export const STREAM_LEN = 4096

export interface LabState {
  cfg: SourceConfig
  raw: BitStream
}

export const state: LabState = {
  cfg: { pOne: 0.53, persistence: 0, stuck: null },
  raw: new Uint8Array(0),
}

type Listener = (s: LabState) => void
const listeners: Listener[] = []

export function subscribe(fn: Listener): void {
  listeners.push(fn)
}

export function regenerate(): void {
  state.raw = generateBits(STREAM_LEN, state.cfg)
  for (const fn of listeners) fn(state)
}

export function setConfig(patch: Partial<SourceConfig>): void {
  Object.assign(state.cfg, patch)
  regenerate()
}
