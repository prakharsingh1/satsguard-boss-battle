# Protocol review notes

This document records the intended inspection contract and the limits of an offline
PSBT preflight. The implementation and tests are the source of truth for supported
checks. It is not a wallet, signer, consensus validator, or security audit.

## Protocol sources

- [BIP 174: PSBT format and v0](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki): map framing, unique keys, required unsigned transaction, version field, supplied UTXOs, and signer checks.
- [bitcoinjs-lib PSBT source](https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/ts_src/psbt.ts): parsing and transaction accessors. The application pins its installed package version in `package.json` and the lockfile.
- [bip174 parser source](https://github.com/bitcoinjs/bip174/blob/master/ts_src/lib/parser/fromBuffer.ts): upstream parser behavior. Its parsing success alone does not establish full input consumption or enforce a zero PSBT global version.
- [BIP 371: Taproot PSBT fields](https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki): Taproot signature and derivation metadata.
- [BIP 341: Taproot signature hashing](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki): SIGHASH_DEFAULT and the allowed Taproot signature hash types.

## Intended checks

1. Accept bounded hex or base64 PSBT data. Reject malformed encodings, truncated
   records, duplicate keys, nonminimal CompactSize encodings, trailing bytes,
   missing required transaction fields, and unsupported PSBT versions.
2. Inspect PSBT v0 only. A missing global version means zero; an explicit version
   must be exactly four bytes and decode to zero. `Psbt.version` is the Bitcoin
   transaction version, not the PSBT format version.
3. Decode every intent address for the explicitly selected network, compare its
   output script with transaction scripts, and compare amounts using exact integer
   satoshis. Treat recipients and change addresses as user declarations. Never
   infer change ownership from a matching derivation path or fingerprint.
4. Sum all outputs to a declared recipient script, so splitting a payment cannot
   hide overpayment. Reject overlapping recipient and change scripts and reject
   undeclared outputs. Script-only or data outputs require explicit handling; an
   address decoder failure does not make an output harmless.
5. For supplied non-witness UTXOs, verify the parent transaction ID matches the
   input outpoint and the output index exists. If both UTXO forms are supplied,
   require the same output value and script. Missing or invalid input data must
   not be counted as zero.
6. Compute a fee only when every input amount is available and consistent. Label
   it as a fee computed from supplied UTXO data. Detect negative fee accounting
   and a declared absolute fee ceiling breach. Do not present an unsigned
   transaction byte count as the final signed virtual size or exact fee rate.
7. Surface nondefault or unknown declared sighash modes and the presence of
   signatures/finalization data. Existing signatures can encode their own sighash
   modes; this implementation warns that their validity and coverage are not
   verified rather than decoding those signatures. An omitted sighash declaration
   is not proof that all existing or future signatures commit to all outputs.
8. Count privacy-sensitive derivation, extended-public-key, and unknown or
   proprietary metadata without exporting their raw values. A redacted report
   must also omit raw PSBT data, transaction IDs, addresses, scripts, public keys,
   preimages, fingerprints, derivation paths, and free-form metadata values.

## Limits that must remain visible

- The selected network is an interpretation for addresses. Bitcoin transaction
  serialization and scripts do not contain a mainnet/testnet marker; testnet and
  signet also share address prefixes. The tool cannot establish the originating
  chain from a PSBT alone.
- Supplied UTXO data is untrusted. A matching parent transaction ID establishes
  internal consistency, not chain inclusion, confirmation, current unspent state,
  or ownership. Witness-only amounts are not independently authenticated here.
- Matching an allowlisted change address does not prove the user controls it.
  The intent must be checked independently of the system producing the PSBT.
- Parsing and payment accounting do not validate script execution, signatures,
  Taproot commitments, input spendability, wallet policy, consensus validity,
  relay policy, dust, or an appropriate market fee.
- A report with no failed declared checks is limited to those checks and those
  declarations. It must never be described as safe to sign.
- Redaction reduces report disclosure; exact amounts, counts, and warning types
  can still be identifying. It is not an anonymization guarantee.

## Meaningful regression cases

These are regression targets. The implementation review status below identifies
what was actually exercised:

| Case | Expected behavior |
| --- | --- |
| Exact recipient amount, explicit change, supplied input amounts | No declared payment/fee check fails; UTXO authenticity limitation remains |
| Additional output to an undeclared script | Failed undeclared-output check |
| Recipient amount split into multiple outputs | Compare summed amount, detect excess/missing amount |
| Recipient/change allowlist overlap | Invalid intent |
| Wrong-network intent address | Invalid intent |
| Missing one input UTXO amount | Fee unknown; fee ceiling cannot be established |
| Non-witness parent transaction hash or output-index mismatch | Invalid input accounting; no trusted fee result |
| Conflicting witness/non-witness amount or script | Failed consistency check; fee unavailable |
| Outputs exceed supplied input total | Failed negative-fee accounting check |
| Decimal, negative, unsafe JS number, or excessive satoshi amount | Invalid intent or invalid accounting |
| Nondefault sighash declaration | Visible sighash warning; no broad signature guarantee |
| Partial signature or finalized input present | Signature validity/coverage warning, including when declared sighash is absent |
| Unknown/proprietary metadata and derivation fields | Metadata presence warning; redacted export contains no raw values |
| PSBT v2, malformed explicit version, duplicated key | Explicit unsupported/invalid parse result |
| Trailing bytes, truncated value, nonminimal CompactSize | Invalid framing result |

## Implementation review status

Static review of `src/engine.js` found the intended framing, payment matching,
integer accounting, supplied-UTXO consistency, unknown-fee handling, and explicit
allowlist export implemented. Two metadata-counting issues were corrected: the
known version field is excluded only in the global map, and an explicit zero
sighash declaration is counted by field presence rather than truthiness.

The reviewer ran `npm test`: all 19 repository tests passed at the time of this
review. Additional in-memory synthetic checks exercised split-recipient excess,
partial missing input values, explicit Taproot DEFAULT decoded from a raw map,
duplicate global keys, an undeclared OP_RETURN output, finalized-signature
warnings, and exclusion of actual derivation and proprietary field values from
redacted JSON. These checks passed. No real keys, real UTXOs, signatures,
transactions, or chain connections were used. This is a focused development
review, not an independent security audit.
