import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Psbt, Transaction, payments, networks } from 'bitcoinjs-lib';
import { analyzePsbt, redactReport, validateIntent, MAX_MONEY_SATS, SatsGuardError } from '../src/engine.js';
import { buildPsbt, DEMO_ADDRESSES, DEMO_FIXTURES, DEMO_INTENT } from '../src/fixtures.js';

const clone = value => JSON.parse(JSON.stringify(value));
const base = DEMO_FIXTURES.find(item => item.id === 'matched-intent');
const analyze = (psbt = base.psbt, intent = clone(DEMO_INTENT)) => analyzePsbt({ psbt, intent });
const codes = report => report.findings.map(item => item.code);
const rejects = (fn, code) => assert.throws(fn, error => error instanceof SatsGuardError && error.code === code);
const hex = bytes => Buffer.from(bytes).toString('hex');
const witnessScript = payments.p2wpkh({ hash: new Uint8Array(20).fill(0x11), network: networks.testnet }).output;

function previousTransaction(value = 100000n, script = witnessScript) {
  const transaction = new Transaction();
  transaction.addInput(new Uint8Array(32).fill(0x99), 0);
  transaction.addOutput(script, value);
  return transaction;
}

function mutatePsbt(mutator) {
  const psbt = Psbt.fromBase64(base.psbt, { network: networks.testnet });
  mutator(psbt);
  return psbt.toBase64();
}

function nonminimalByte(bytes, position) {
  assert.ok(bytes[position] < 0xfd, 'This synthetic field has a one-byte CompactSize.');
  return Buffer.concat([bytes.subarray(0, position), Buffer.from([0xfd, bytes[position], 0]), bytes.subarray(position + 1)]);
}

function rewriteFixtureUnsignedTransaction(transform) {
  const bytes = Buffer.from(base.psbt, 'base64');
  // The deterministic fixture begins with a one-byte unsigned-transaction key and length.
  assert.deepEqual([...bytes.subarray(5, 7)], [1, 0]);
  assert.ok(bytes[7] < 0xfd);
  const changed = transform(bytes.subarray(8, 8 + bytes[7]));
  assert.ok(changed.length < 0xfd);
  return Buffer.concat([bytes.subarray(0, 7), Buffer.from([changed.length]), changed, bytes.subarray(8 + bytes[7])]).toString('base64');
}

test('synthetic matched proposal uses exact sats and passes only declared checks', () => {
  const report = analyze();
  assert.equal(report.status, 'checks-passed');
  assert.equal(report.summary.totalInputSats, '100000');
  assert.equal(report.summary.totalOutputSats, '99000');
  assert.equal(report.summary.feeSats, '1000');
  assert.equal(report.summary.feeSource, 'supplied-psbt-claims');
  assert.equal(report.summary.feeChainVerified, false);
  assert.deepEqual(report.outputs.map(item => item.role), ['payment', 'change']);
  assert.deepEqual(report.findings.map(item => item.severity), ['info', 'info']);
  assert.equal(base.synthetic, true);
});

test('all four scenarios produce their documented distinct failure modes', () => {
  const reports = Object.fromEntries(DEMO_FIXTURES.map(fixture => [fixture.id, analyzePsbt(fixture)]));
  assert.equal(reports['fee-spike'].summary.feeSats, '10000');
  assert.equal(reports['fee-spike'].status, 'blocked');
  assert.ok(codes(reports['fee-spike']).includes('FEE_CAP_EXCEEDED'));
  assert.equal(reports['recipient-swap'].status, 'blocked');
  assert.ok(codes(reports['recipient-swap']).includes('UNEXPECTED_OUTPUT'));
  assert.ok(codes(reports['recipient-swap']).includes('PAYMENT_AMOUNT_MISMATCH'));
  assert.equal(reports['missing-values'].status, 'review');
  assert.equal(reports['missing-values'].summary.feeSats, null);
  assert.equal(reports['missing-values'].summary.totalInputSats, null);
  assert.equal(reports['missing-values'].summary.feeSource, 'unknown');
  assert.ok(codes(reports['missing-values']).includes('MISSING_INPUT_VALUE'));
});

test('hex, whitespace, and unpadded base64 decode to the same report', () => {
  const expected = analyze();
  const asHex = Buffer.from(base.psbt, 'base64').toString('hex');
  assert.deepEqual(analyze(`0x${asHex}`), expected);
  assert.deepEqual(analyze(base.psbt.replace(/(.{20})/g, '$1\n')), expected);
  assert.deepEqual(analyze(base.psbt.replace(/=+$/, '')), expected);
});

test('malformed encodings, malformed maps, truncation, and trailing bytes are rejected', () => {
  rejects(() => analyze(''), 'INVALID_ENCODING');
  rejects(() => analyze('not a psbt!'), 'INVALID_ENCODING');
  rejects(() => analyze('00'), 'INVALID_PSBT');
  rejects(() => analyze(base.psbt.slice(0, -8)), 'INVALID_PSBT');
  const bytes = Buffer.from(base.psbt, 'base64');
  rejects(() => analyze(Buffer.concat([bytes, Buffer.from([0])]).toString('base64')), 'INVALID_PSBT');
  const nonminimal = Buffer.concat([bytes.subarray(0, 5), Buffer.from([0xfd, 1, 0]), bytes.subarray(6)]);
  rejects(() => analyze(nonminimal.toString('base64')), 'INVALID_PSBT');
});

test('nonminimal counts and script lengths inside the unsigned transaction are rejected', () => {
  // Version is four bytes; this fixture has one empty-script input and two P2WPKH outputs.
  for (const position of [4, 41, 46, 55]) {
    const payload = rewriteFixtureUnsignedTransaction(transaction => nonminimalByte(transaction, position));
    assert.equal(Psbt.fromBase64(payload).txOutputs[0].value, 50000n, 'Upstream still decodes the mutated proposal.');
    rejects(() => analyze(payload), 'INVALID_PSBT');
  }
});

test('nonminimal script length inside a witness UTXO is rejected', () => {
  const bytes = Buffer.from(base.psbt, 'base64');
  const inputStart = 9 + bytes[7];
  assert.deepEqual([...bytes.subarray(inputStart, inputStart + 2)], [1, 1]);
  const lengthPosition = inputStart + 2;
  const valueStart = inputStart + 3;
  const valueEnd = valueStart + bytes[lengthPosition];
  const changedValue = nonminimalByte(bytes.subarray(valueStart, valueEnd), 8);
  const payload = Buffer.concat([bytes.subarray(0, lengthPosition), Buffer.from([changedValue.length]), changedValue, bytes.subarray(valueEnd)]).toString('base64');
  assert.equal(Psbt.fromBase64(payload).data.inputs[0].witnessUtxo.value, 100000n);
  rejects(() => analyze(payload), 'INVALID_PSBT');
});

test('valid map ordering is preserved as a permitted representation', () => {
  const bytes = Buffer.from(base.psbt, 'base64');
  // Unknown global field precedes UNSIGNED_TX; map order is not transaction serialization.
  const reordered = Buffer.concat([bytes.subarray(0, 5), Buffer.from([1, 0x50, 1, 0x11]), bytes.subarray(5)]);
  const report = analyze(reordered.toString('base64'));
  assert.equal(report.summary.feeSats, '1000');
  assert.equal(report.status, 'review');
  assert.ok(codes(report).includes('UNKNOWN_METADATA'));
});

test('PSBT v2 is explicitly rejected before v0 parsing and v0 tx version 2 remains accepted', () => {
  // Minimal v2 envelope with only a declared version; the format is unsupported regardless of missing v2 fields.
  const v2 = Buffer.from('70736274ff01fb040200000000', 'hex').toString('base64');
  rejects(() => analyze(v2), 'UNSUPPORTED_PSBT_VERSION');
  const explicitV2 = mutatePsbt(psbt => psbt.addUnknownKeyValToGlobal({ key: Uint8Array.of(0xfb), value: Uint8Array.of(2, 0, 0, 0) }));
  rejects(() => analyze(explicitV2), 'UNSUPPORTED_PSBT_VERSION');
  const explicitV0 = mutatePsbt(psbt => psbt.addUnknownKeyValToGlobal({ key: Uint8Array.of(0xfb), value: Uint8Array.of(0, 0, 0, 0) }));
  assert.equal(analyze(explicitV0).status, 'checks-passed');
  assert.equal(Psbt.fromBase64(base.psbt).version, 2);
});

test('version field length and nonminimal key type encodings are rejected', () => {
  const malformedVersion = mutatePsbt(psbt => psbt.addUnknownKeyValToGlobal({ key: Uint8Array.of(0xfb), value: Uint8Array.of(0, 0, 0) }));
  rejects(() => analyze(malformedVersion), 'INVALID_PSBT');
  const nonminimalType = mutatePsbt(psbt => psbt.addUnknownKeyValToGlobal({ key: Uint8Array.of(0xfd, 1, 0), value: Uint8Array.of(0) }));
  rejects(() => analyze(nonminimalType), 'INVALID_PSBT');
});

test('declared amounts and cap must be exact decimal strings within the money range', () => {
  for (const amount of [50000, '5e4', '050000', '50000.0', '-1', '+1', '0', (MAX_MONEY_SATS + 1n).toString()]) {
    const intent = clone(DEMO_INTENT);
    intent.payments[0].amountSats = amount;
    rejects(() => analyze(base.psbt, intent), 'INVALID_INTENT');
  }
  const intent = clone(DEMO_INTENT);
  intent.maxFeeSats = 2000;
  rejects(() => validateIntent(intent), 'INVALID_INTENT');
});

test('network is checked for declared addresses and never guessed from the PSBT', () => {
  const intent = clone(DEMO_INTENT);
  intent.network = 'bitcoin';
  rejects(() => analyze(base.psbt, intent), 'INVALID_INTENT');
  intent.network = 'regtest';
  rejects(() => validateIntent(intent), 'INVALID_INTENT');
});

test('repeated output recipients and repeated declarations are aggregated by decoded script', () => {
  const intent = clone(DEMO_INTENT);
  intent.payments = [
    { address: DEMO_ADDRESSES.payment, amountSats: '20000' },
    { address: DEMO_ADDRESSES.payment.toUpperCase(), amountSats: '30000' },
  ];
  const psbt = buildPsbt({ inputs: [{ valueSats: '100000' }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '15000' },
    { address: DEMO_ADDRESSES.payment, amountSats: '35000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] });
  const report = analyze(psbt, intent);
  assert.equal(report.status, 'checks-passed');
  assert.equal(report.payments.length, 1);
  assert.deepEqual(report.payments[0].outputIndexes, [0, 1]);
  assert.equal(report.payments[0].actualSats, '50000');
});

test('payment/change overlap is rejected even for equivalent address encodings', () => {
  const intent = clone(DEMO_INTENT);
  intent.changeAddresses.push(DEMO_ADDRESSES.payment.toUpperCase());
  rejects(() => analyze(base.psbt, intent), 'INVALID_INTENT');
});

test('change is never inferred from position or residual amount', () => {
  const intent = clone(DEMO_INTENT);
  intent.changeAddresses = [];
  const report = analyze(base.psbt, intent);
  assert.equal(report.status, 'blocked');
  assert.equal(report.outputs[1].role, 'unexpected');
  assert.ok(codes(report).includes('UNEXPECTED_OUTPUT'));
});

test('a negative claimed fee is blocked', () => {
  const psbt = buildPsbt({ inputs: [{ valueSats: '98000' }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] });
  const report = analyze(psbt);
  assert.equal(report.summary.feeSats, '-1000');
  assert.ok(codes(report).includes('NEGATIVE_FEE'));
  assert.equal(report.status, 'blocked');
});

test('accounting preserves individual satoshis near the Bitcoin money limit', () => {
  const intended = MAX_MONEY_SATS - 2n;
  const psbt = buildPsbt({ inputs: [{ valueSats: MAX_MONEY_SATS.toString() }], outputs: [{ address: DEMO_ADDRESSES.payment, amountSats: intended.toString() }] });
  const intent = clone(DEMO_INTENT);
  intent.payments[0].amountSats = intended.toString();
  const report = analyze(psbt, intent);
  assert.equal(report.summary.feeSats, '2');
  assert.equal(report.summary.totalOutputSats, '2099999999999998');
  assert.equal(report.status, 'checks-passed');
});

test('individual amounts and transaction totals beyond the money limit are blocked', () => {
  const psbt = buildPsbt({ inputs: [{ valueSats: (MAX_MONEY_SATS + 1n).toString() }], outputs: [{ address: DEMO_ADDRESSES.payment, amountSats: '50000' }] });
  const report = analyze(psbt);
  assert.ok(codes(report).includes('INPUT_AMOUNT_OUT_OF_RANGE'));
  assert.equal(report.summary.feeSats, null);
  const totalPsbt = buildPsbt({ inputs: [{ valueSats: MAX_MONEY_SATS.toString() }, { valueSats: '1' }], outputs: [{ address: DEMO_ADDRESSES.payment, amountSats: '50000' }] });
  assert.ok(codes(analyze(totalPsbt)).includes('INPUT_TOTAL_OUT_OF_RANGE'));
  const outputPsbt = buildPsbt({ inputs: [{ valueSats: MAX_MONEY_SATS.toString() }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: MAX_MONEY_SATS.toString() },
  ] });
  assert.ok(codes(analyze(outputPsbt)).includes('OUTPUT_TOTAL_OUT_OF_RANGE'));
});

test('non-witness UTXO amount is used only after txid and vout match', () => {
  const previous = previousTransaction();
  const psbt = buildPsbt({ inputs: [{ hash: previous.getHash(), index: 0, nonWitnessUtxo: previous.toBuffer() }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] });
  const report = analyze(psbt);
  assert.equal(report.status, 'checks-passed');
  assert.equal(report.inputs[0].source, 'nonWitnessUtxo');
  assert.equal(report.summary.feeSats, '1000');
  const wrongHash = buildPsbt({ inputs: [{ hash: new Uint8Array(32).fill(0x55), nonWitnessUtxo: previous.toBuffer() }], outputs: [{ address: DEMO_ADDRESSES.payment, amountSats: '50000' }] });
  assert.ok(codes(analyze(wrongHash)).includes('PREV_TXID_MISMATCH'));
  assert.equal(analyze(wrongHash).summary.feeSats, null);
  const missingVout = buildPsbt({ inputs: [{ hash: previous.getHash(), index: 1, nonWitnessUtxo: previous.toBuffer() }], outputs: [{ address: DEMO_ADDRESSES.payment, amountSats: '50000' }] });
  assert.ok(codes(analyze(missingVout)).includes('PREV_OUTPUT_MISSING'));
});

test('noncanonical previous transaction data is blocked without computing a fee', () => {
  const previous = previousTransaction();
  const noncanonical = nonminimalByte(Buffer.from(previous.toBuffer()), 4);
  const psbt = buildPsbt({ inputs: [{ hash: previous.getHash(), index: 0, nonWitnessUtxo: noncanonical }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] });
  const report = analyze(psbt);
  assert.equal(report.status, 'blocked');
  assert.ok(codes(report).includes('INVALID_PREV_TRANSACTION'));
  assert.equal(report.summary.totalInputSats, null);
  assert.equal(report.summary.feeSats, null);
});

test('canonical previous transactions with witness data remain accepted', () => {
  const previous = previousTransaction();
  previous.setWitness(0, [Uint8Array.of(0x51)]);
  const psbt = buildPsbt({ inputs: [{ hash: previous.getHash(), index: 0, nonWitnessUtxo: previous.toBuffer() }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] });
  const report = analyze(psbt);
  assert.equal(report.status, 'checks-passed');
  assert.equal(report.summary.feeSats, '1000');
});

test('both UTXO forms must agree on amount and script', () => {
  const previous = previousTransaction();
  const spec = { inputs: [{ hash: previous.getHash(), valueSats: '100000', nonWitnessUtxo: previous.toBuffer() }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] };
  assert.equal(analyze(buildPsbt(spec)).status, 'checks-passed');
  spec.inputs[0].valueSats = '100001';
  const amountConflict = analyze(buildPsbt(spec));
  assert.ok(codes(amountConflict).includes('UTXO_FIELDS_CONFLICT'));
  assert.equal(amountConflict.summary.feeSats, null);
  spec.inputs[0].valueSats = '100000';
  spec.inputs[0].scriptHex = hex(payments.p2wpkh({ hash: new Uint8Array(20).fill(0x77), network: networks.testnet }).output);
  assert.ok(codes(analyze(buildPsbt(spec))).includes('UTXO_FIELDS_CONFLICT'));
});

test('metadata and explicit nondefault sighash produce scoped review warnings', () => {
  const payload = mutatePsbt(psbt => {
    psbt.updateInput(0, { sighashType: 0x83 });
    psbt.addUnknownKeyValToGlobal({ key: Uint8Array.of(0xfc, 1, 0x41, 0), value: new TextEncoder().encode('private-note') });
    psbt.addUnknownKeyValToInput(0, { key: Uint8Array.of(0xfb), value: Uint8Array.of(0) });
  });
  const report = analyze(payload);
  assert.equal(report.status, 'review');
  assert.equal(report.metadata.proprietaryFieldCount, 1);
  assert.equal(report.metadata.unknownFieldCount, 1);
  assert.equal(report.metadata.explicitSighashCount, 1);
  assert.ok(codes(report).includes('NONDEFAULT_SIGHASH'));
  assert.ok(codes(report).includes('PROPRIETARY_METADATA'));
  assert.ok(codes(report).includes('UNKNOWN_METADATA'));
  assert.equal(JSON.stringify(redactReport(report)).includes('private-note'), false);
});

test('proof-of-reserves commitments are counted by presence, warned about, and never exported', () => {
  for (const commitment of ['synthetic-private-commitment', '']) {
    // The upstream updater rejects empty strings by truthiness; its decoder accepts the field.
    const payload = mutatePsbt(psbt => { psbt.data.inputs[0].porCommitment = commitment; });
    const report = analyze(payload);
    assert.equal(report.status, 'review');
    assert.equal(report.metadata.proofOfReservesCommitmentCount, 1);
    assert.ok(codes(report).includes('POR_COMMITMENT_METADATA'));
    const exported = redactReport(report);
    assert.equal(exported.metadata.proofOfReservesCommitmentCount, 1);
    assert.equal(Object.hasOwn(exported.inputs[0], 'porCommitment'), false);
    if (commitment) assert.equal(JSON.stringify(exported).includes(commitment), false);
  }
});

test('a single missing input amount prevents total fee computation across multiple inputs', () => {
  const psbt = buildPsbt({ inputs: [{ valueSats: '100000' }, { valueSats: null }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] });
  const report = analyze(psbt);
  assert.equal(report.summary.totalInputSats, null);
  assert.equal(report.summary.feeSats, null);
  assert.equal(report.status, 'review');
  assert.equal(report.inputs[0].valueSats, '100000');
  assert.equal(report.inputs[1].valueSats, null);
});

test('non-address output scripts are unexpected rather than treated as change', () => {
  const psbt = buildPsbt({ inputs: [{ valueSats: '100000' }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
    { scriptHex: '6a04deadbeef', amountSats: '0' },
  ] });
  const report = analyze(psbt);
  assert.equal(report.outputs[2].address, null);
  assert.equal(report.outputs[2].scriptType, 'OP_RETURN');
  assert.equal(report.outputs[2].role, 'unexpected');
  assert.equal(report.status, 'blocked');
});

test('duplicate keys in a PSBT map are rejected', () => {
  const bytes = Buffer.from(base.psbt, 'base64');
  // The first/global unsigned transaction pair uses one-byte lengths in this fixture.
  assert.equal(bytes[5], 1);
  assert.equal(bytes[6], 0);
  assert.ok(bytes[7] < 0xfd);
  const end = 8 + bytes[7];
  const duplicated = Buffer.concat([bytes.subarray(0, end), bytes.subarray(5, end), bytes.subarray(end)]);
  rejects(() => analyze(duplicated.toString('base64')), 'INVALID_PSBT');
});

test('derivation, extended public key, and finalized signature metadata trigger privacy/scope warnings without exporting values', () => {
  const pubkey = Uint8Array.from(Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'));
  const extendedPubkey = new Uint8Array(78);
  extendedPubkey.set([0x04, 0x35, 0x87, 0xcf], 0);
  extendedPubkey[4] = 3;
  extendedPubkey.fill(0x55, 13, 45);
  extendedPubkey.set(pubkey, 45);
  const payload = mutatePsbt(psbt => {
    psbt.updateGlobal({ globalXpub: [{ extendedPubkey, masterFingerprint: new Uint8Array(4).fill(0xaa), path: "m/84'/1'/0'" }] });
    psbt.updateInput(0, { bip32Derivation: [{ pubkey, masterFingerprint: new Uint8Array(4).fill(0xaa), path: "m/84'/1'/0'/0/7" }], finalScriptWitness: Uint8Array.of(0) });
  });
  const report = analyze(payload);
  assert.equal(report.metadata.globalXpubCount, 1);
  assert.equal(report.metadata.bip32DerivationCount, 1);
  assert.equal(report.metadata.signatureFieldCount, 1);
  assert.ok(codes(report).includes('XPUB_EXPOSURE'));
  assert.ok(codes(report).includes('DERIVATION_EXPOSURE'));
  assert.ok(codes(report).includes('SIGNATURES_NOT_VERIFIED'));
  assert.equal(report.status, 'review');
  const exported = JSON.stringify(redactReport(report));
  assert.equal(exported.includes(hex(pubkey)), false);
  assert.equal(exported.includes(hex(extendedPubkey)), false);
  assert.equal(exported.includes("m/84'"), false);
});

test('Taproot default sighash zero is counted, and Taproot spending policy remains unverified', () => {
  const psbt = Psbt.fromBase64(buildPsbt({ inputs: [{ valueSats: '100000', scriptHex: `5120${'55'.repeat(32)}` }], outputs: [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ] }), { network: networks.testnet });
  // Work around upstream addInput's falsey-zero update check; toBase64 encodes this standard field.
  psbt.data.inputs[0].sighashType = 0;
  const report = analyze(psbt.toBase64());
  assert.equal(report.metadata.explicitSighashCount, 1);
  assert.ok(codes(report).includes('TAPROOT_POLICY_UNCHECKED'));
  assert.equal(codes(report).includes('NONDEFAULT_SIGHASH'), false);
  assert.equal(report.status, 'review');
});

test('redacted report contains accounting but excludes all transaction identifiers and raw payload', () => {
  const report = analyze();
  const exported = redactReport(report);
  const json = JSON.stringify(exported);
  assert.equal(exported.redacted, true);
  assert.equal(exported.summary.feeSats, '1000');
  assert.equal(exported.outputs[0].amountSats, '50000');
  for (const value of [base.psbt, ...Object.values(DEMO_ADDRESSES), ...report.outputs.map(output => output.scriptHex)]) assert.equal(json.includes(value), false);
  const allKeys = value => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => [key, ...allKeys(item)]) : [];
  assert.equal(allKeys(exported).includes('address'), false);
  assert.equal(allKeys(exported).includes('scriptHex'), false);
  // Explicit allowlist also ignores unexpected sensitive properties appended to report objects.
  report.summary.rawPayload = base.psbt;
  report.metadata.pubkey = 'private-value';
  report.inputs[0].outpoint = 'private-value';
  report.outputs[0].pubkey = 'private-value';
  assert.equal(JSON.stringify(redactReport(report)).includes('private-value'), false);
});

test('CLI shares engine, exports redacted JSON, and uses 0/1/2 policy exit codes', () => {
  for (const [id, expectedCode] of [['matched-intent', 0], ['missing-values', 1], ['recipient-swap', 2], ['fee-spike', 2]]) {
    const result = spawnSync(process.execPath, ['scripts/cli.mjs', '--demo', id], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, expectedCode, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.redacted, true);
    assert.equal(result.stdout.includes(DEMO_ADDRESSES.payment), false);
  }
  const invalid = spawnSync(process.execPath, ['scripts/cli.mjs', '--demo', 'missing'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'INVALID_ARGUMENTS');
});
