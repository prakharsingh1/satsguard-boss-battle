# SatsGuard

Offline Bitcoin PSBT intent preflight for humans and CLI workflows. Prepared for CodeStorm 2026: FutureForge by Prakhar Singh with OpenAI Codex AI assistance.

A proposed transaction can have a plausible fee and still pay the wrong recipient. SatsGuard compares a real BIP174 PSBT v0 against an explicit payment policy. It shows every output, checks exact payment totals and an absolute fee cap, flags privacy metadata and exports a redacted report. It never signs, broadcasts, reads keys or contacts a chain API.

## Run

Requires Node.js 22.12+ (or 20.19+). Developed and tested with Node 26.5.0.

```sh
npm ci
npm test
npm run dev
```

For the prebuilt current v0.2 app, download this repository’s source ZIP, extract it and open `demo/index.html`. No app installation or build is required; its JavaScript, CSS and icon are embedded. `demo/guide.html` is included beside it. The raw HTML download is served as text: save it as `index.html` before opening locally.

For source development, open the localhost URL printed by Vite. Production build: `npm run build`. To regenerate the standalone app, run `npm run standalone`; this refreshes `demo/index.html` and `demo/guide.html` as well as the local `publication` copies. The commands above reproduce the source tests and CLI.

The separately prepared release package and captioned video are not advertised as published downloads while the CodeStorm release remains a draft.

## Four reproducible examples

All examples contain invented testnet outpoints and fixed public-key hashes. They do not claim to be spendable transactions.

| Example | Expected outcome | Evidence |
| --- | --- | --- |
| Matched intent | No declared checks failed | Payment 50,000, declared change 49,000, supplied input 100,000, fee 1,000 sats |
| Fee spike | Blocked | Fee 10,000 sats exceeds cap 2,000 |
| Recipient swap | Blocked | 50,000 sats go to an undeclared destination; expected recipient receives zero |
| Missing input value | Review required | Recipients match; fee is unknown and its cap cannot be checked |

The UI starts with the recipient-swap example so the central failure mode is immediately visible. Edit the intent or payload and rerun. Stale reports cannot be exported.

## Agent integration

```sh
node scripts/cli.mjs --demo matched-intent
node scripts/cli.mjs --demo recipient-swap
node scripts/cli.mjs --psbt proposal.psbt --intent intent.json
cat proposal.psbt | node scripts/cli.mjs --psbt - --intent intent.json
```

The CLI accepts base64 or hex text, uses the same engine as the UI, and outputs redacted JSON. Exit 0 means no declared checks failed; exit 1 means review required; exit 2 means blocked or invalid input. There is no agent model, autonomous payment system or signing integration in this prototype.

Policy schema:

```json
{
  "network": "testnet",
  "payments": [
    { "address": "A_VALID_TESTNET_RECIPIENT", "amountSats": "50000" }
  ],
  "changeAddresses": ["A_VALID_DECLARED_CHANGE_ADDRESS"],
  "maxFeeSats": "2000"
}
```

Amounts must be decimal strings of whole satoshis. The network is `bitcoin` or `testnet` (testnet and signet share address prefixes). Address encodings are decoded into scripts; repeated recipient declarations and outputs are aggregated. A script cannot be both payment and change. Every undeclared output is flagged. No change is inferred from key metadata.

## Trust and privacy boundaries

- A result is a comparison with declared intent, **not approval to sign**.
- Input values are supplied PSBT claims. Previous transaction hashes/output indexes and conflicting UTXO fields are checked for internal consistency; chain existence, ownership and unspent status are unverified.
- No signature verification, script execution, Taproot spending-policy validation, final fee-rate calculation, dust/relay policy, wallet integration or mainnet transaction testing.
- PSBT v0 only. Unsupported versions, malformed maps, duplicate keys, trailing data and nonminimal map, unsigned-transaction and witness-UTXO length encodings are rejected. Opaque metadata and Taproot policy values are not fully format-validated.
- Analysis runs in browser memory. No analytics, remote fonts, remote APIs, local storage or payload uploads. Hosting still sees ordinary page requests.
- The redacted export excludes raw payloads, addresses, scripts, outpoints, public keys and derivation values. Amounts, transaction shape, field-presence counts and deterministic observations remain. This is not an anonymity guarantee.
- The app observes metadata; it does not sanitize or alter the original PSBT. Treat PSBT files as sensitive even when unsigned.

## Architecture

`src/engine.js` validates intent, performs a strict PSBT envelope check, delegates protocol parsing to bitcoinjs-lib, compares script/amount groups and supplied accounting, and creates an allowlisted export.

`src/fixtures.js` builds deterministic synthetic examples with bitcoinjs-lib. `src/main.js` renders the form, output allocation map and findings. `scripts/cli.mjs` shares the engine. `tests/engine.test.js` contains meaningful regression tests. Protocol review notes are in `docs/protocol-notes.md`.

## Validation

Run `npm test` for the committed tests. They cover exact satoshi accounting, malformed and unsupported encodings, recipient aggregation, network validation, missing/conflicting inputs, previous transaction consistency, fee policy, metadata warnings, redaction and actual CLI exit codes. Additional browser QA evidence is documented in `docs/validation.md`.

## Originality and attribution

The original UI, policy engine, fixtures, tests and documentation were built on October 5, 2026 while preparing for BOSS Battle. That project was never submitted to BOSS Battle. This CodeStorm entry reuses the full October 5 prototype, then adds parser and metadata inspection fixes, fresh verification, and event-specific documentation. Both development dates fall within CodeStorm's August 1–October 15 window. Git commits reflect actual development order; no backdating. OpenAI Codex generated and reviewed code on Prakhar Singh's behalf. AI assistance is disclosed; no AI model is integrated into the product.

Protocol parsing is reused from **bitcoinjs-lib 7.0.1** (MIT). Build tooling: **Vite 7.3.6** (MIT). Transitive dependencies retain their own licenses. Primary references: [BIP174](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki), [BIP371](https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki), and [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib).

SatsGuard's original source is available under the MIT license in `LICENSE`.

Judge evaluation uses the current prebuilt app in `demo/index.html` and the repository source ZIP. Release packaging steps are in [docs/offline-release.md](docs/offline-release.md); that release remains unpublished. The existing GitHub Pages URL redirects through an unrelated account custom domain and is not advertised as a working live demo.

This is a small, reviewable prototype. It has not been professionally audited or used to process real funds.
