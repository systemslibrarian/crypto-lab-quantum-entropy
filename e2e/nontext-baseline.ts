/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  // The only findings the live oracle reports over {dark, light} × {1280, 380}
  // and every state the drive builds, and both are in the SHARED Crypto Lab top
  // bar rather than in anything this repo owns.
  //
  // `.cl-btn` draws its edge as
  // `1px solid color-mix(in srgb, var(--accent, #35d6bb) 38%, transparent)`
  // over the bar's fixed `#0b1512` — and it reads `--accent` from THE LAB, not
  // from the bar. That is worth writing down as a fleet-wide observation,
  // because it means the shared bar's boundary contrast is a function of a token
  // each lab picks for itself and which nobody measures against the bar: a lab
  // that declares no `--accent` gets the teal fallback and 2.45:1, while this
  // lab's indigo gave 1.27:1. Lightening `--accent` to fix this lab's own button
  // fills (see `style.css`) moved it to 1.46:1 as a side effect, and improved
  // the `.cl-badge` edge from 2.38:1 to 3.45:1. The value is IDENTICAL IN BOTH
  // THEMES, because the bar is always dark and the page theme does not move it.
  //
  // Every repo in this fleet carries a byte-identical copy of that markup and
  // CSS, and `CLAUDE.md` is explicit that a change every lab should get is a
  // reviewed fleet-wide pass and never an overwrite driven from one repo. So it
  // is measured here, ratcheted here, and reported upward.
  //
  // Everything inside `#app` — all seven panels and every control in them — is
  // audited with no exemption, and comes back clean.
  'control-boundary|a.cl-btn': { ratio: 1.46, required: 3, unverified: false },
};
