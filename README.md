# Quantum Entropy — crypto-lab

**QRNG · min-entropy · randomness extraction.** A biased quantum source producing real randomness, and the extractor that turns a stream nobody can predict into a stream nobody can distinguish.

## What It Is

An interactive, browser-only demo of the front half of a randomness stack: a **modeled beam-splitter QRNG** feeding **real entropy measurements** (Shannon entropy vs min-entropy, `H∞ = −log₂ max p`), **real von Neumann debiasing**, a **real Toeplitz-matrix randomness extractor** (2-universal hashing over GF(2), with Leftover Hash Lemma accounting), and the **NIST SP 800-90B continuous health tests** (Repetition Count Test and Adaptive Proportion Test), all placed in the SP 800-90C architecture: entropy source → health tests → conditioning → DRBG seed → DRBG.

The concept it teaches: a quantum source is unpredictable by physics, not by assumption — **and it is still not usable as a key**. Raw quantum output is biased, correlated, and partially known to whoever built the hardware. Min-entropy measures what's actually there; an extractor converts it into uniform bits. The gap between "unpredictable" and "uniform" is where QRNG marketing lives and where the real engineering happens.

**What's real vs modeled:** the photon source is a labeled **model** (the browser CSPRNG plays the role of the quantum process, so the imperfections — detector mismatch, afterpulsing correlation, a stuck detector — are learner-controllable). Everything downstream of the raw bit stream is real math running on those actual bits: the entropy measurements, the debiaser, the GF(2) matrix–vector multiply, the LHL arithmetic, and the 800-90B tests with their spec-derived cutoffs.

**Security model & honesty:** no real quantum hardware, no device-independent certification, and no claim that passing anything here certifies entropy. This demo does **not** prove any generated bits are random — it shows the *accounting* by which real systems bound what an attacker faces. Not production crypto — a teaching demo. All bit material is per-session, in memory only.

## Exhibits

1. **The source** — a modeled beam-splitter QRNG with learner-controlled detector mismatch (bias), afterpulsing (lag-1 correlation), and a stick-the-detector failure switch. Emits 4,096-bit raw streams.
2. **Shannon vs min-entropy** — both computed live off the same stream, plotted as curves with a marker at the measured bias. At 53/47: Shannon H = 0.9974 bits/bit (the marketing number) vs H∞ = 0.9159 bits/bit (what one optimal guess faces). Slide the bias: Shannon barely moves; min-entropy falls off a cliff. When you add correlation, the panel switches to the measured first-order predictor, because bias alone no longer bounds the attacker.
3. **Von Neumann debiasing** — step-through animation of real pairs (01→0, 10→1, 00/11→discard), output becoming exactly unbiased, throughput collapsing to ~p(1−p). Then the honest limit, caused by you: make the source streaky and the **bias check still passes while the security verdict rejects** — a first-order predictor guesses most output bits. Von Neumann fixes bias, not correlation.
4. **Toeplitz extraction** — a real m×256 Toeplitz matrix from a fresh CSPRNG seed, real GF(2) matrix–vector multiply, with the Leftover Hash Lemma receipt: ε ≤ ½·√(2^(m−k)). Crank m past k and watch the security margin evaporate — the output still *looks* perfectly random, which is exactly why the accounting, not the appearance, is the verdict.
5. **SP 800-90B health tests** — RCT (cutoff C = 1 + ⌈20/H⌉ = 21 at H = 1) and APT (window 1024, cutoff 589) running live. Stick a detector: bits keep flowing while the tests fire — a dead source outputs a beautiful constant.
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
- **Extracting more than you have.** The LHL bound is brutal and exact: m > k means no guarantee, and no output-facing test will warn you.
- **Confusing health tests with entropy estimation.** RCT/APT detect death and gross degradation. A manufacturer-keyed PRNG passes both forever.

## Real-World Usage

Commercial QRNGs (ID Quantique, Quantinuum, cloud entropy services) implement exactly this pipeline: a physical source with a characterized min-entropy claim, continuous SP 800-90B health tests, and conditioning (frequently Toeplitz hashing, e.g. in quantum-key-distribution post-processing) before any bit reaches a DRBG. Linux's `/dev/random`, Intel RDSEED, and every FIPS-validated entropy source follow the same 800-90B/C discipline: estimate min-entropy, test continuously, condition, then seed a DRBG.

## How to Run Locally

```bash
npm ci
npm run dev        # Vite dev server
npm test           # 35 Vitest unit tests, incl. 8 spec KATs
npm run build      # typecheck + production build
npm run test:a11y  # axe-core WCAG 2.1 A/AA gate, both themes (preview on port 4337)
```

## Related Demos

- [crypto-lab-drbg-arena](https://systemslibrarian.github.io/crypto-lab-drbg-arena/) — what happens *after* the seed (and the SP 800-22 suite).
- [crypto-lab-entropy-collapse](https://systemslibrarian.github.io/crypto-lab-entropy-collapse/) — a *shared* seed; this lab is a *weak* one.
- [crypto-lab-corrupted-oracle](https://systemslibrarian.github.io/crypto-lab-corrupted-oracle/) — what happens when the DRBG itself is rigged.
- [crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/) / [crypto-lab-e91](https://systemslibrarian.github.io/crypto-lab-e91/) — quantum measurement for key *agreement*; e91's CHSH exhibit underlies device-independent randomness.

## Build & Verify

- **35 unit tests** (Vitest, colocated `src/**/*.test.ts`), all passing.
- **8 spec known-answer tests:** Shannon/min-entropy at p = 0.53 (0.9974 / 0.9159), p = 0.5 and p = 0.75; von Neumann's 1951 pairing procedure; a hand-computed 4×4 Toeplitz GF(2) vector; SP 800-90B RCT cutoffs (the spec's own worked example H = 7.3 → C = 4, and H = 1 → C = 21); the binary APT cutoff (W = 1024, α = 2⁻²⁰ → C = 589). Plus property tests: GF(2) linearity, exhaustive 2-universality at m = n = 3, exact debiasing, ~p(1−p) throughput, and the debiaser-passes-bias-while-predictable failure.
- **Accessibility gate:** `npm run build && npm run test:a11y` — zero axe-core WCAG 2.1 A/AA violations in **both** themes against the production build, with every panel driven into its post-interaction states (including the alarm states) before scanning. Enforced in CI before deploy.

## Performance

Everything runs in-browser on 4,096-bit streams; the heaviest operation (a 256×256 GF(2) matrix–vector multiply plus 511-bit seed draw) completes in well under a millisecond. No workers, no backend.

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
