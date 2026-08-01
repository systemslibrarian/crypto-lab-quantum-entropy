# Quantum Entropy — crypto-lab

**QRNG · min-entropy · randomness extraction.** A biased quantum source producing real randomness, and the extractor that turns a stream nobody can predict into a stream nobody can distinguish.

## What It Is

An interactive, browser-only demo of the front half of a randomness stack: a **modeled beam-splitter QRNG** feeding **real entropy measurements** (Shannon entropy vs min-entropy, `H∞ = −log₂ max p`), **real von Neumann debiasing**, a **real Toeplitz-matrix randomness extractor** (2-universal hashing over GF(2), with Leftover Hash Lemma accounting), and **continuous health tests illustrating the RCT and APT defined by NIST SP 800-90B §4.4** — stateful monitors whose run/window state survives emission boundaries, whose cutoffs derive from a commissioned entropy claim, and whose alarms latch and block the extractor until an explicit recommissioning action. The whole pipeline is placed in the SP 800-90C architecture: entropy source → health tests → conditioning → DRBG seed → DRBG.

**Two lanes, kept separate on purpose.** Every number used for cryptographic accounting (the extraction budget k, the health-test claim, the attacker-work figure) comes from the **configured source model** — for this repeat-or-fresh Markov model, the exact probability of its most likely 256-bit path, computed by dynamic program and verified against exhaustive enumeration in tests. Statistics measured on the emitted sample (bias p̂, predictor accuracy) are displayed as **observed diagnostics** and are never promoted into a guarantee — measuring your own input and calling it a bound is the classic accounting sin this lab exists to teach.

The concept it teaches: a quantum source is unpredictable by physics, not by assumption — **and it is still not usable as a key**. Raw quantum output is biased, correlated, and partially known to whoever built the hardware. Min-entropy measures what's actually there; an extractor converts it into uniform bits. The gap between "unpredictable" and "uniform" is where QRNG marketing lives and where the real engineering happens.

**What's real vs modeled:** the photon source is a labeled **model** (the browser CSPRNG plays the role of the quantum process, so the imperfections — detector mismatch, afterpulsing correlation, a stuck detector — are learner-controllable). Everything downstream of the raw bit stream is real math running on those actual bits: the entropy measurements, the debiaser, the GF(2) matrix–vector multiply, the LHL arithmetic, and the 800-90B tests with their spec-derived cutoffs.

**Security model & honesty:** no real quantum hardware, no device-independent certification, and no claim that passing anything here certifies entropy. This demo does **not** prove any generated bits are random — it shows the *accounting* by which real systems bound what an attacker faces. Not production crypto — a teaching demo. All bit material is per-session, in memory only.

## Exhibits

1. **The source** — a modeled beam-splitter QRNG, drawn as a live diagram (photon → half-silvered mirror → detectors A/B with click percentages), with learner-controlled detector mismatch (bias), afterpulsing (lag-1 correlation), and a stick-the-detector failure switch. Emits 4,096-bit raw streams.
2. **Shannon vs min-entropy** — both computed live off the same stream, plotted as curves with a marker at the measured bias. At 53/47: Shannon H = 0.9974 bits/bit (the marketing number) vs H∞ = 0.9159 bits/bit (what one optimal guess faces). Slide the bias: Shannon barely moves; min-entropy falls off a cliff. When you add correlation, the panel switches to the measured first-order predictor, because bias alone no longer bounds the attacker. A live stat translates the gap into stakes: what a naive 256-bit key cut from these bits actually costs to guess, vs what Shannon math would claim.
3. **Von Neumann debiasing** — step-through animation of real pairs (01→0, 10→1, 00/11→discard), output becoming exactly unbiased, throughput collapsing to ~p(1−p). Then the honest limit, caused by you: make the source streaky and the **bias check still passes while the security verdict rejects** — a first-order predictor guesses most output bits. Von Neumann fixes bias, not correlation.
4. **Toeplitz extraction** — a real m×256 Toeplitz matrix from a fresh CSPRNG seed, real GF(2) matrix–vector multiply, with the Leftover Hash Lemma receipt under one convention throughout: ε(k,m) = ½·√(2^(m−k)), solved exactly as m ≤ k + 2 − 2·log₂(1/ε). The budget k is the model's block min-entropy, drawn live in an entropy-budget bar (k available of 256 raw, m demanded, margin or overdraft shaded). Crank m past k and watch the guarantee evaporate — the output still *looks* perfectly random, which is exactly why the accounting, not the appearance, is the verdict. The accept/warn lines (2⁻³²/2⁻¹⁰) are labeled as this lab's teaching policy, not part of the theorem.
5. **Continuous health tests (SP 800-90B §4.4 RCT + APT)** — cutoffs derive from a *commissioned* per-sample entropy claim (0.915 bit/sample for the default 53/47 device — claiming H = 1 for it would false-alarm the APT roughly a thousand times too often, a mistake an earlier version of this lab made and now teaches). Monitor state persists across emissions, runs and windows straddle chunk boundaries correctly, and an alarm **latches**: the extractor refuses input until you repair the source and explicitly recommission. Stick a detector: bits keep flowing while the boundary slams shut — a dead source outputs a beautiful constant.
6. **The architecture** — where this sits in SP 800-90C, which stages the sibling demos own, and the one construction that doesn't require trusting the manufacturer (device-independent, Bell-certified randomness — named, linked to e91's CHSH exhibit, deliberately not built).

## When to Use It

- To understand why "quantum RNG" on a spec sheet is the *start* of a security argument, not the end of one.
- To see the difference between Shannon entropy and min-entropy on the same data, and why NIST SP 800-90B counts only the latter.
- To learn what a randomness extractor actually buys and what it costs (a seed, and output length as a security parameter).
- **Do NOT use it** to generate key material, to evaluate a real entropy source (a real SP 800-90B assessment involves far more than the two measures shown), or as an implementation reference for production conditioning.

## Live Demo

**<https://systemslibrarian.github.io/crypto-lab-quantum-entropy/>**

Emit photons from an imperfect device, watch the two entropy numbers diverge, step von Neumann pairs, break the debiaser with correlation, extract with a real Toeplitz matrix and overdraw the entropy budget, and trip the 800-90B health tests with a stuck detector.

## What Can Go Wrong

- **Trusting the Shannon number.** A 53/47 source is "99.7% random" by Shannon and only 0.9159 bits/bit by min-entropy. Provision a 256-bit key by the wrong number and you overstate the attacker's work by 20+ bits.
- **Debiasing without de-correlating.** Von Neumann output passes frequency tests on *any* stationary source — including one whose bits a predictor guesses 80% of the time. (A debiased-but-correlated stream also passes many SP 800-22 statistical tests; that suite lives in drbg-arena.)
- **Measuring your own input and calling it a bound.** An empirical bias or an in-sample predictor score is a diagnostic, not a min-entropy guarantee for the input distribution. The extraction budget must come from a validated model or assessment — here, the exact most-likely-path bound of the configured model.
- **Extracting more than you have.** The LHL bound is brutal and exact: once m exceeds k the guarantee is vacuous, and no output-facing test will warn you.
- **Claiming more entropy than the device has.** Health-test cutoffs derive from the claim; claim H = 1 for a 53/47 device and the APT false-alarms ~1,000× its nominal 2⁻²⁰ rate. Commissioning ties the claim to the model bound, and degradation below the claim is flagged instead of silently reinterpreted.
- **Confusing health tests with entropy estimation.** RCT/APT detect death and gross degradation. A manufacturer-keyed PRNG passes both forever.

## Real-World Usage

The discipline shown here — characterize a physical source's min-entropy, run continuous health tests, condition the raw output, then seed a deterministic generator — is the shape mandated by NIST SP 800-90B/90C for validated entropy sources, and variants of it appear across real systems: commercial QRNG products publish min-entropy claims and run continuous tests; Toeplitz hashing is a standard conditioning step in quantum-key-distribution post-processing; OS randomness pools and hardware sources (e.g. `/dev/random`'s input pool, RDSEED's conditioning stage) apply the same estimate → test → condition pattern in their own architectures. The architectures, parameters, and assurance claims differ per system — this lab teaches the shared accounting, not any one product's design.

## How to Run Locally

```bash
npm ci
npm run dev        # Vite dev server
npm test           # 47 Vitest unit tests, incl. 8 spec KATs and exhaustive oracles
npm run build      # typecheck + production build
npm run test:a11y  # axe WCAG 2.1 A/AA gate (both themes) + health-gate + responsive checks, port 4337
```

## Related Demos

- [crypto-lab-drbg-arena](https://systemslibrarian.github.io/crypto-lab-drbg-arena/) — what happens *after* the seed (and the SP 800-22 suite).
- [crypto-lab-entropy-collapse](https://systemslibrarian.github.io/crypto-lab-entropy-collapse/) — a *shared* seed; this lab is a *weak* one.
- [crypto-lab-corrupted-oracle](https://systemslibrarian.github.io/crypto-lab-corrupted-oracle/) — what happens when the DRBG itself is rigged.
- [crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/) / [crypto-lab-e91](https://systemslibrarian.github.io/crypto-lab-e91/) — quantum measurement for key *agreement*; e91's CHSH exhibit underlies device-independent randomness.

## Build & Verify

- **47 unit tests** (Vitest, colocated `src/**/*.test.ts`), all passing.
- **8 spec known-answer tests:** Shannon/min-entropy at p = 0.53 (0.9974 / 0.9159), p = 0.5 and p = 0.75; von Neumann's 1951 pairing procedure; a hand-computed 4×4 Toeplitz GF(2) vector; SP 800-90B RCT cutoffs (the spec's own worked example H = 7.3 → C = 4, and H = 1 → C = 21); the binary APT cutoff (W = 1024, α = 2⁻²⁰ → C = 589).
- **Oracle and invariant tests:** the block min-entropy dynamic program proven equal to exhaustive enumeration over all sequences for n ≤ 10 across a bias/persistence grid, with its i.i.d. (n·H∞) and stuck (k = 0) reductions; RCT/APT monitors alarm at identical lifetime positions under every tested chunk split, including a cross-boundary run that per-chunk batch evaluation provably misses; alarms latch against healthy data; the LHL output-length solve honors its target ε and fails it at m+1; GF(2) linearity; exhaustive 2-universality at m = n = 3; exact debiasing; ~p(1−p) throughput; the debiaser-passes-bias-while-predictable failure; and fail-closed domain validation on the mathematical API.
- **Browser gate:** `npm run build && npm run test:a11y` — zero axe-core WCAG 2.1 A/AA violations in **both** themes against the production build with every panel driven into its post-interaction states (including latched-alarm states); a semantic check that the latched health alarm disables extraction until repair + recommission; and no horizontal overflow at 320, 390, and 768 px. Enforced in CI before deploy.

## Performance

Everything runs in-browser on 4,096-bit streams. The heaviest operation is a 256-row GF(2) Toeplitz matrix–vector multiply (~65k bit operations) plus a 511-bit seed draw — small enough that no workers or backend are involved.

---

*One of 170+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
