# Catique HUB — Release runbook

| Field | Value |
|---|---|
| Owner | release-engineer (Sergey) + dzenlotus (paying party) |
| Status | E1 — CI scaffold landed; signing pipeline awaits cert delivery |
| Last updated | 2026-04-28 |
| Authoritative procurement memo | [`code-signing-procurement.md`](https://github.com/dzenlotus/promptery/blob/main/docs/catique-migration/code-signing-procurement.md) (in promptery repo) |

This runbook is the operational counterpart to the Wave 0 procurement
memo. Read the memo first if you need the **why**; this document is the
**how**, kept in the catique-hub repo so it lives next to the workflows
it controls.

---

## 1. CI workflow map

| Workflow | Trigger | Purpose |
|---|---|---|
| `.github/workflows/ci.yml` | `push` / `pull_request` to `main` | Lint, type-check, test, license scan. Cheap, fast, ubuntu-only. |
| `.github/workflows/build.yml` | `workflow_dispatch`, `v*` tags, or reusable call from `release.yml` | Cross-platform installer build (mac arm64 + win x64). Conditionally signs. |
| `.github/workflows/release.yml` | `v*` tag push | Calls `build.yml`, downloads artifacts, drafts a GitHub release. |

Coverage gate (NFR §5.1) is documented at 75% branches for E1 but **not
yet enforced** — coverage tooling lands in E2.

---

## 2. GitHub Actions secrets — names dzenlotus must configure

When the certificates are delivered (post-procurement), run `gh secret
set <NAME>` for each entry below. The workflows fall back to unsigned
builds with a `::warning::` annotation when a secret is missing, so it
is safe to merge the workflows now and add secrets later.

### 2.1 Apple (macOS code-signing + notarization)

Source: §2.5 of `code-signing-procurement.md`. Apple Developer
**Individual** enrollment under dzenlotus's Apple ID is the chosen path.

| Secret name | Source / how to compute | Notes |
|---|---|---|
| `APPLE_CERT_BASE64` | `base64 -i Developer-ID-Application.p12 \| pbcopy` | Exported from Keychain Access (Personal Information Exchange) |
| `APPLE_CERT_PASSWORD` | The password set during `.p12` export | Store in 1Password vault `catique-release` |
| `APPLE_TEAM_ID` | 10-char alphanumeric from developer.apple.com → Membership | E.g. `ABCD1E2F3G` |
| `APPLE_API_KEY_ID` | 10-char ID from App Store Connect API key page | App Store Connect → Users and Access → Keys |
| `APPLE_API_ISSUER_ID` | UUID from same page | Per-account identifier |
| `APPLE_API_KEY_BASE64` | `base64 -i AuthKey_<KeyID>.p8 \| pbcopy` | Downloaded **once** from App Store Connect; if lost, regenerate |

> Note: the procurement memo originally proposed `APPLE_CERT_P12_BASE64`,
> `APPLE_CERT_P12_PASSWORD`, and `APPLE_API_KEY_P8_BASE64`. The CI
> workflows use shorter names (`APPLE_CERT_BASE64`, `APPLE_CERT_PASSWORD`,
> `APPLE_API_KEY_BASE64`) for consistency with the `tauri-action` env
> conventions. The 1Password items track both names so future audits
> map cleanly.

### 2.2 Windows (SSL.com EV via eSigner cloud HSM)

Source: §3.2 of `code-signing-procurement.md`. SSL.com EV with eSigner
cloud HSM is the chosen path (no physical USB token).

| Secret name | Source | Notes |
|---|---|---|
| `WINDOWS_SSLCOM_USERNAME` | SSL.com account email | The account that owns the EV cert |
| `WINDOWS_SSLCOM_PASSWORD` | SSL.com account password | Rotate when staff change |
| `WINDOWS_SSLCOM_CREDENTIAL_ID` | eSigner credential identifier | Visible in SSL.com customer portal |
| `WINDOWS_SSLCOM_TOTP_SECRET` | TOTP seed for cloud HSM 2FA | Captured during eSigner enrollment; required for unattended CI signing |
| `WINDOWS_CERT_BASE64` | *(reserved — not used by current workflow)* | Placeholder for an on-prem `.p12` fallback if cloud HSM is ever revoked |
| `WINDOWS_CERT_PASSWORD` | *(reserved)* | Placeholder companion to `WINDOWS_CERT_BASE64` |

> The two `WINDOWS_CERT_*` placeholders give us a stable contract if we
> ever need to fall back to physical-token signing (procurement memo
> §3.4). They can stay unset under the current cloud-HSM plan.

### 2.3 Bulk setup — copy/paste

```bash
# Apple
gh secret set APPLE_CERT_BASE64 < <(base64 -i path/to/Developer-ID-Application.p12)
gh secret set APPLE_CERT_PASSWORD
gh secret set APPLE_TEAM_ID
gh secret set APPLE_API_KEY_BASE64 < <(base64 -i path/to/AuthKey_XXXXX.p8)
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER_ID

# Windows (SSL.com eSigner cloud HSM)
gh secret set WINDOWS_SSLCOM_USERNAME
gh secret set WINDOWS_SSLCOM_PASSWORD
gh secret set WINDOWS_SSLCOM_CREDENTIAL_ID
gh secret set WINDOWS_SSLCOM_TOTP_SECRET
```

Run `gh secret list` afterwards to confirm everything landed (values
are masked — only names + dates are shown, which is fine for audit).

---

## 3. Local sign-test before flipping the activation PR

When secrets are first configured, **do not merge straight to main**.
Test signing on a throwaway branch.

1. Create branch `chore/activate-codesign`.
2. Push a no-op commit and a test tag (e.g. `v0.0.0-signing-test.1`).
3. Watch `release.yml` run; download the resulting `.dmg` / `.msi`.
4. macOS: `codesign --verify --strict --verbose=4 Catique\ HUB.app` →
   exit 0 + identifier line. Then `spctl --assess --type execute -vvv
   Catique\ HUB.app` → "accepted".
5. Windows: `signtool verify /pa /v "Catique HUB.msi"` → "Successfully
   verified". Optional: cross-check signature with
   `Get-AuthenticodeSignature` in PowerShell.
6. If both verifications pass, merge `chore/activate-codesign` and
   delete the test tag (`git push --delete origin v0.0.0-signing-test.1`).
7. Tag the next real release (`v0.1.0`) and let `release.yml` produce
   the first signed artifacts.

---

## 4. Secret-rotation policy

Mirrors §5.4 of the procurement memo, restated here for the operational
audience.

| Trigger | Action |
|---|---|
| Cert renewal (Apple yearly, SSL.com EV every 3 years) | Update 1Password item, re-run `gh secret set` for the affected names, kick `release.yml` via `workflow_dispatch` to confirm the new cert signs cleanly. |
| Suspected leak (cert exposed in CI logs, accidental commit, etc.) | Revoke at the CA (Apple Developer portal / SSL.com customer portal). Reissue. Rotate **all** secrets. Add a `decision-log.md` entry as a security incident. |
| GitHub PAT / `gh` auth rotation | No effect on workflow secrets; only impacts the operator running `gh secret set`. |
| Maintainer handoff (theoretical post-v1.0) | Reissue all certs in the new maintainer's name; do not transfer `.p12` / `.p8` files. |

---

## 5. References

- `code-signing-procurement.md` (promptery repo) — full Wave 0 procurement memo with vendor trade-offs and decision rationale.
- `nfr-rust-stack.md` (promptery repo) — NFR §5 (coverage), §6 (license allowlist) drove the CI gates here.
- `decision-log.md` — D-018 records the final code-signing decision once dzenlotus approves.

---

## 6. Changelog

- **0.1 — 2026-04-28.** Initial runbook by Sergey (release-engineer) as
  part of Wave E1.4 (CI scaffold). Documents the secret names the
  workflows look for; signing path is dormant until certs arrive.
