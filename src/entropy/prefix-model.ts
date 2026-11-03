/** A synthetic distribution: d public zero bits followed by n-d independent fair bits. */
export function prefixModel(n: number, d: number) {
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(d) || d < 0 || d > n) {
    throw new RangeError('Require integer n >= 1 and 0 <= d <= n')
  }
  return {
    minEntropy: n - d,
    rate: (n - d) / n,
    uniformPrefixProbability: 2 ** -d,
    distance: 1 - 2 ** -d,
  }
}
