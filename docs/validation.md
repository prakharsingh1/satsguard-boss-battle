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

