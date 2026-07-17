/** Tiny DOM helpers — no framework, everything inspectable. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else node.setAttribute(k, v)
  }
  node.append(...children)
  return node
}

export function html(target: HTMLElement, markup: string): void {
  target.innerHTML = markup
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const node = root.querySelector<HTMLElement>(sel)
  if (!node) throw new Error(`missing element: ${sel}`)
  return node
}

/** Format bits as space-grouped 0/1 text (first `max` bits). */
export function bitsToText(bits: Uint8Array, max = 1024): string {
  const shown = bits.subarray(0, max)
  let out = ''
  for (let i = 0; i < shown.length; i++) {
    if (i > 0 && i % 8 === 0) out += ' '
    out += shown[i]
  }
  if (bits.length > max) out += ` … (+${bits.length - max} more)`
  return out
}

export function bitsToHex(bits: Uint8Array): string {
  let hex = ''
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16)
  }
  return hex
}

export function fmt(x: number, digits = 4): string {
  return x.toFixed(digits)
}

export function pct(x: number, digits = 1): string {
  return `${(100 * x).toFixed(digits)}%`
}

/** Human-readable power of two, e.g. 2^-53 ≈ 1.1e-16. */
export function sci(x: number): string {
  if (x === 0) return '0'
  if (x >= 0.001) return x.toPrecision(3)
  return x.toExponential(1)
}
