# Validation evidence

October 5, 2026. All transaction fixtures used below are synthetic testnet proposals with invented outpoints.

## Automated checks

- Node 26.5.0, bitcoinjs-lib 7.0.1, Vite 7.3.6.
- `npm test`: 24 tests, 24 passed, 0 failed.
- `npm run standalone`: production build and a bundled standalone HTML completed.
- Patched dependency installation reported 0 known vulnerabilities from npm's advisory database.
- A separate protocol review exercised split recipients, partial missing amounts, duplicate keys, finalized fields, unknown outputs and actual metadata value redaction. See protocol-notes.md for scope.

## Actual Microsoft Edge QA

- Recipient swap: two declared checks failed (unexpected destination and missing intended recipient).
- Matched intent: no declared checks failed, fee 1,000 sats.
- Fee spike: blocked, supplied fee 10,000 above cap 2,000 sats.
- Missing input value: review required, total input and fee unknown.
- Missing-input scenario continued to run after tab networking was disabled with CDP following initial load. Networking was restored after the test.
- Editing the fee cap marked the report stale and disabled its export. Rerunning a 500-sat cap against the matched example blocked its 1,000-sat fee.
- Malformed payload cleared previous results and disabled export.
- Mobile viewport 390 × 844: document width and scroll width both 390 px; controls remain available in a stacked layout. The temporary viewport was reset.
- Actual JPEG captures are in the local output directory. They show synthetic fixtures and no private account data.

No mainnet transactions, keys, wallet integrations, signatures, broadcasts or external chain lookups were used. These checks are evidence for the stated prototype scope, not a security audit.


## CodeStorm continuation — October 6, 2026 UTC

The original October 5 prototype was reused. A fresh Node 26.5.0 run passed all 30 tests, including six new regressions for canonical transaction encoding, witness UTXO script lengths, permitted map ordering, and proof-of-reserves commitment presence/redaction. Focused independent review found no actionable issues and checked large canonical script lengths, witness data and Unicode/empty commitment redaction.

The demo retains actual October 5 app captures and freshly rerun CLI evidence. Its event labeling was updated for CodeStorm; those four scenario behaviors are unchanged by the parser and metadata fixes. H.264/AAC video duration: 159.644 seconds, 1920 × 1080. It uses synthetic narration.

## Release recovery — October 6, 2026 UTC

An isolated copy preserved the original worker's files while completing release preparation. A fresh `npm test` run passed all 30 tests with zero failures. `npm run standalone` rebuilt the production app successfully (87 transformed modules) and embedded its JavaScript and CSS into the standalone HTML.

A separate focused review found no actionable issue within the documented scope. Eight additional synthetic checks covered canonical witness UTXO script lengths at the 252/253 and 65,535/65,536 boundaries, empty and Unicode proof-of-reserves commitments with presence warnings and no raw-value export, and canonical previous transactions with extended script/witness lengths and exact fee accounting. UI escaping and stale/error report-export guards were also inspected.

The supplied demo was inspected with ffprobe: H.264 video at 1920 × 1080, AAC audio, duration 159.643813 seconds. No real funds, keys, transactions, signing, broadcasting or chain lookups were involved. Release publication and Devfolio submission are separate steps; this document does not claim a submission receipt.
