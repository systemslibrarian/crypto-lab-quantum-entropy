/** Restricted sufficient bounds, Dodis–Pietrzak–Wichs, Corollaries 4.3/4.5.
 * No converse lemma, sample-based entropy estimate, or production KDF execution.
 */
export interface KdfModel {
  n: number
  k: number
  m: number
  b: number
  independence: number
  game: string
  seed: string
  family: string
  hypothetical: boolean
}

export type KdfResult = { supported: false; reason: string } | {
  supported: true
  route: 'no-loss' | 'small-loss'
  factor: number
  exponent: number
  bound: number
  requiredIndependence: number
  minimumSmallLossEntropy: number
}

export function kdfBound(model: KdfModel): KdfResult {
  const { n, k, m, b, independence } = model
  const refuse = (reason: string): KdfResult => ({ supported: false, reason })
  if (![n, k, m, independence].every(x => Number.isSafeInteger(x) && x >= 1 && x <= 65536)) {
    return refuse('Enter whole numbers from 1 to 65,536 for n, k, m and hash independence. This is the calculator’s supported range.')
  }
  if (!Number.isInteger(b) || b < 6 || b > 256) return refuse('Choose a whole-number baseline exponent b from 6 to 256.')
  if (n < k || k < m) return refuse('The supported routes require n ≥ k ≥ m. Source min-entropy cannot exceed its bit length.')
  if (model.game !== 'unpredictability') return refuse('Choose a specified unpredictability game. These bounds do not cover a general indistinguishability claim or an unspecified game.')
  if (model.seed !== 'independent-uniform') return refuse('The seed must be uniform, public and independent of the source. A correlated, fixed or unknown seed is unsupported.')
  if (model.family !== 'independent') return refuse('These results require the stated high-wise-independent hash family. They are not bounds for HKDF or an arbitrary hash.')
  if (!model.hypothetical) return refuse('No bound shown for unverified real-world inputs. Select the illustrative model to stipulate its source-entropy and application-baseline assumptions.')
  const minimumSmallLossEntropy = m + Math.ceil(Math.log2(b)) + 4
  const route = k === m ? 'no-loss' : 'small-loss'
  if (route === 'small-loss' && k < minimumSmallLossEntropy) {
    return refuse(`This calculator covers k = m (${m}) or k ≥ ${minimumSmallLossEntropy}. It does not interpolate the gap between those routes.`)
  }
  const requiredIndependence = b + (route === 'no-loss' ? 1 : 6)
  if (independence < requiredIndependence) return refuse(`This route requires at least ${requiredIndependence}-wise independence; the stated family provides ${independence}.`)
  const factor = route === 'no-loss' ? b + 1 : 3
  return { supported: true, route, factor, exponent: b, bound: factor * 2 ** -b, requiredIndependence, minimumSmallLossEntropy }
}
