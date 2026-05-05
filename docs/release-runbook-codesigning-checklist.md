# Code-Signing Certificate Purchase Checklist (ctq-62)

**Status:** action required from maintainer — agents cannot purchase certs.
**Date:** 2026-05-05
**Owner:** maintainer (dzenlotus)
**Unblocks:** v1.0 Distribution (signed `.dmg` for macOS, signed `.msi`/`.exe` for Windows)

---

## macOS — Apple Developer Program

| Item | Detail |
|---|---|
| Subscription | Apple Developer Program — **$99 / year** (individual) |
| Sign-up URL | https://developer.apple.com/programs/enroll/ |
| Apple ID | use a dedicated `developer@…` mailbox; not the personal one |
| Identity needed | full legal name + government ID for individual; D-U-N-S number if company |
| Certificate types to generate (after enrollment) | (1) **Developer ID Application** — for `.app` notarized distribution; (2) **Developer ID Installer** — only if shipping `.pkg` (we ship `.dmg`, so skip) |
| Notarization | uses the same Apple ID + an **app-specific password** generated in https://appleid.apple.com → Sign-In and Security |
| Storage | export `.p12` from Keychain Access → password-protect → store in 1Password / age-encrypted file. Never commit. |
| CI secrets to add later | `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD` |

Lead time: ~24-72 h for individual approval; longer if Apple flags ID verification.

---

## Windows — code-signing certificate

There are two viable paths. **EV is preferred** because it skips the SmartScreen reputation cliff for a brand-new publisher.

### Option A — EV (Extended Validation)

| Item | Detail |
|---|---|
| Cost | **$300–600 / year** depending on CA |
| Issuers (pick one) | DigiCert, Sectigo, SSL.com, GlobalSign |
| Hardware | mandatory hardware token (USB key) shipped via courier; private key never leaves the token |
| Identity | full validated identity (passport + utility bill + sometimes notarized affidavit); **takes 5-15 business days** |
| SmartScreen | Microsoft trusts EV certs immediately — no warning on first download |
| CI fit | trickier: EV requires the token to be physically present at signing time. For CI, use a remote-signing service from the CA (DigiCert KeyLocker, SSL.com eSigner) — adds ~$10-20 / signing event or a flat fee |

### Option B — OV (Organization Validation) / IV (Individual Validation)

| Item | Detail |
|---|---|
| Cost | **$150–300 / year** |
| Hardware | since June 2023, OV also requires hardware token / cloud HSM (Microsoft policy change) |
| Identity | lighter than EV, ~3-7 business days |
| SmartScreen | publisher must build "reputation" via downloads — early users see "unrecognized publisher" warning until enough installs accumulate |

**Recommendation:** EV via SSL.com or DigiCert with their cloud-signing service. Costs more but zero reputation cliff and CI-compatible without shipping a physical USB to whoever runs the build.

---

## Action checklist

- [ ] Enroll in Apple Developer Program ($99) using `developer@…` mailbox
- [ ] After approval, generate Developer ID Application certificate; export `.p12` to encrypted vault
- [ ] Generate app-specific password for notarization
- [ ] Decide EV vs OV for Windows (recommendation: EV + cloud-signing)
- [ ] Order cert from chosen CA, complete identity verification
- [ ] When token / cloud-signing creds arrive: store in encrypted vault
- [ ] Record decision + costs in `docs/decision-log.md` (next free `D-NN`) — separate task ctq-62
- [ ] Update `docs/release-runbook.md` with the actual issuer + token-handling procedure once certs are in hand

---

## Out of scope for this task

- Wiring secrets into CI — separate task post-cert-arrival, blocked by ctq-62
- Notarization workflow design — already covered in `docs/release-runbook.md`
- Linux signing — Linux is out of scope per Catique HUB platform list

---

## Reporting back

When both certs are obtained, ping the maintainer to:
1. Move ctq-62 from `v0.4 Skeleton` → `done` (or appropriate Roadmap location).
2. Add `D-NN | YYYY-MM-DD | Code-signing certs purchased (Apple + Windows EV) | (no ADR — see release-runbook)` to `docs/decision-log.md`.
3. File a follow-up ctq-task for CI integration.
