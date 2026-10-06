import { Psbt, Transaction, address as bitcoinAddress, networks } from 'bitcoinjs-lib';

export const MAX_MONEY_SATS = 2_100_000_000_000_000n;
const MAX_PSBT_BYTES = 1_000_000;
const MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];
const NETWORKS = { bitcoin: networks.bitcoin, testnet: networks.testnet };

export class SatsGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SatsGuardError';
    this.code = code;
  }
}

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const equalBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const fail = (code, message) => { throw new SatsGuardError(code, message); };

function parseSats(value, label, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 16) {
    fail('INVALID_INTENT', `${label} must be a decimal string of whole satoshis without signs, separators, or leading zeros.`);
  }
  const amount = BigInt(value);
  if (amount > MAX_MONEY_SATS || (positive && amount === 0n)) {
    fail('INVALID_INTENT', `${label} must be ${positive ? 'positive and ' : ''}within Bitcoin's maximum money range.`);
  }
  return amount;
}

/** Validate declared policy. Amounts deliberately never pass through floating point. */
export function validateIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) fail('INVALID_INTENT', 'Intent must be a JSON object.');
  if (!Object.hasOwn(NETWORKS, intent.network)) fail('INVALID_INTENT', 'Intent network must be bitcoin or testnet.');
  if (!Array.isArray(intent.payments) || intent.payments.length < 1 || intent.payments.length > 1000) {
    fail('INVALID_INTENT', 'Declare between 1 and 1000 payments.');
  }
  if (!Array.isArray(intent.changeAddresses) || intent.changeAddresses.length > 1000) {
    fail('INVALID_INTENT', 'changeAddresses must be an array with at most 1000 addresses.');
  }
  const network = NETWORKS[intent.network];
  const decode = (value, label) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 150) fail('INVALID_INTENT', `${label} must be a Bitcoin address.`);
    const normalized = value.trim();
    try { return { address: normalized, script: hex(bitcoinAddress.toOutputScript(normalized, network)) }; }
    catch { fail('INVALID_INTENT', `${label} is invalid for the declared network.`); }
  };
  let totalPayments = 0n;
  const paymentScripts = new Set();
  const payments = intent.payments.map((payment, index) => {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) fail('INVALID_INTENT', `Payment ${index + 1} must be an object.`);
    const decoded = decode(payment.address, `Payment ${index + 1} address`);
    const amount = parseSats(payment.amountSats, `Payment ${index + 1} amountSats`, true);
    totalPayments += amount;
    paymentScripts.add(decoded.script);
    return { address: decoded.address, amountSats: amount.toString() };
  });
  if (totalPayments > MAX_MONEY_SATS) fail('INVALID_INTENT', 'The declared payment total exceeds Bitcoin\'s maximum money range.');
  const changeScripts = new Set();
  const changeAddresses = [];
  intent.changeAddresses.forEach((value, index) => {
    const decoded = decode(value, `Change address ${index + 1}`);
    if (paymentScripts.has(decoded.script)) fail('INVALID_INTENT', 'A script cannot be both a declared payment and a change destination.');
    if (!changeScripts.has(decoded.script)) changeAddresses.push(decoded.address);
    changeScripts.add(decoded.script);
  });
  return { network: intent.network, payments, changeAddresses, maxFeeSats: parseSats(intent.maxFeeSats, 'maxFeeSats').toString() };
}

function decodePayload(payload) {
  if (typeof payload !== 'string' || !payload.trim()) fail('INVALID_ENCODING', 'Paste a PSBT in base64 or hexadecimal format.');
  if (payload.length > MAX_PSBT_BYTES * 3) fail('PSBT_TOO_LARGE', 'PSBT exceeds the 1 MB local inspection limit.');
  let value = payload.replace(/\s/g, '');
  if (value.startsWith('0x')) value = value.slice(2);
  let bytes;
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    bytes = Uint8Array.from(value.match(/.{2}/g), pair => Number.parseInt(pair, 16));
  } else {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1 || (value.includes('=') && value.length % 4 !== 0)) {
      fail('INVALID_ENCODING', 'PSBT encoding is neither valid hexadecimal nor standard base64.');
    }
    try {
      const binary = atob(value);
      // Reject alternate encodings with non-zero base64 padding bits.
      if (btoa(binary).replace(/=+$/, '') !== value.replace(/=+$/, '')) throw new Error();
      bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    } catch { fail('INVALID_ENCODING', 'PSBT base64 encoding is malformed.'); }
  }
  if (bytes.length > MAX_PSBT_BYTES) fail('PSBT_TOO_LARGE', 'PSBT exceeds the 1 MB local inspection limit.');
  if (bytes.length < MAGIC.length || !MAGIC.every((byte, i) => bytes[i] === byte)) fail('INVALID_PSBT', 'Payload does not have the PSBT magic header.');
  return bytes;
}

/*
 * bitcoinjs-lib parses PSBT fields and transactions. This gate rejects
 * non-minimal map and witness-UTXO lengths and trailing data tolerated by the
 * library, and reads the declared PSBT version before v0-only parsing.
 * Parsed transaction values are also compared with their canonical encoding.
 */
function readCompactSize(bytes, position, end = bytes.length) {
  if (position >= end) fail('INVALID_PSBT', 'PSBT is truncated.');
  const prefix = bytes[position++];
  if (prefix < 0xfd) return { value: prefix, next: position };
  const count = prefix === 0xfd ? 2 : prefix === 0xfe ? 4 : 8;
  if (position + count > end) fail('INVALID_PSBT', 'PSBT has a truncated length field.');
  let value = 0n;
  for (let i = 0; i < count; i++) value |= BigInt(bytes[position + i]) << BigInt(i * 8);
  if ((prefix === 0xfd && value < 0xfdn) || (prefix === 0xfe && value <= 0xffffn) || (prefix === 0xff && value <= 0xffffffffn)) {
    fail('INVALID_PSBT', 'PSBT uses a non-minimal CompactSize encoding.');
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('INVALID_PSBT', 'PSBT length is outside the supported range.');
  return { value: Number(value), next: position + count };
}

function scanMap(bytes, start, scope) {
  let position = start;
  let version = 0;
  let versionSeen = false;
  let unsignedTransaction;
  while (true) {
    const keyLength = readCompactSize(bytes, position);
    position = keyLength.next;
    if (keyLength.value === 0) return { next: position, version, unsignedTransaction };
    const keyEnd = position + keyLength.value;
    if (keyEnd > bytes.length) fail('INVALID_PSBT', 'PSBT has a truncated map key.');
    const type = readCompactSize(bytes, position, keyEnd);
    const exactVersionKey = scope === 'global' && type.value === 0xfb;
    if (exactVersionKey && (keyLength.value !== 1 || versionSeen)) fail('INVALID_PSBT', 'PSBT version field must have one unique byte key.');
    position = keyEnd;
    const valueLength = readCompactSize(bytes, position);
    position = valueLength.next;
    if (position + valueLength.value > bytes.length) fail('INVALID_PSBT', 'PSBT has a truncated map value.');
    if (exactVersionKey) {
      if (valueLength.value !== 4) fail('INVALID_PSBT', 'PSBT version field must contain exactly four bytes.');
      version = new DataView(bytes.buffer, bytes.byteOffset + position, 4).getUint32(0, true);
      versionSeen = true;
    }
    if (scope === 'global' && type.value === 0 && keyLength.value === 1) {
      unsignedTransaction = bytes.subarray(position, position + valueLength.value);
    }
    if (scope === 'input' && type.value === 1 && keyLength.value === 1) {
      const valueEnd = position + valueLength.value;
      const scriptLength = readCompactSize(bytes, position + 8, valueEnd);
      if (scriptLength.next + scriptLength.value !== valueEnd) fail('INVALID_PSBT', 'Witness UTXO script length does not match its value.');
    }
    position += valueLength.value;
  }
}

function parsePsbt(payload, network) {
  const bytes = decodePayload(payload);
  const global = scanMap(bytes, MAGIC.length, 'global');
  if (global.version !== 0) fail('UNSUPPORTED_PSBT_VERSION', `PSBT version ${global.version} is unsupported. This inspector supports BIP174 PSBT version 0 only.`);
  let psbt;
  try { psbt = Psbt.fromBuffer(bytes, { network }); }
  catch { fail('INVALID_PSBT', 'PSBT version 0 could not be parsed. Check that it contains a valid unsigned transaction and well-formed maps.'); }
  if (!global.unsignedTransaction || !equalBytes(global.unsignedTransaction, psbt.data.globalMap.unsignedTx.toBuffer())) {
    fail('INVALID_PSBT', 'The unsigned transaction uses a non-canonical serialization.');
  }
  let position = global.next;
  for (let i = 0; i < psbt.inputCount; i++) position = scanMap(bytes, position, 'input').next;
  for (let i = 0; i < psbt.txOutputs.length; i++) position = scanMap(bytes, position, 'output').next;
  if (position !== bytes.length) fail('INVALID_PSBT', 'PSBT contains trailing bytes or unexpected maps.');
  return psbt;
}

function scriptType(script) {
  if (script.length === 22 && script[0] === 0 && script[1] === 20) return 'P2WPKH';
  if (script.length === 34 && script[0] === 0 && script[1] === 32) return 'P2WSH';
  if (script.length === 34 && script[0] === 0x51 && script[1] === 32) return 'P2TR';
  if (script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 && script[2] === 20 && script[23] === 0x88 && script[24] === 0xac) return 'P2PKH';
  if (script.length === 23 && script[0] === 0xa9 && script[1] === 20 && script[22] === 0x87) return 'P2SH';
  if (script[0] === 0x6a) return 'OP_RETURN';
  return 'other';
}

function inspectMetadata(psbt, addFinding) {
  const maps = [psbt.data.globalMap, ...psbt.data.inputs, ...psbt.data.outputs];
  const count = key => maps.reduce((total, map) => total + (Array.isArray(map[key]) ? map[key].length : map[key] !== undefined ? 1 : 0), 0);
  const unknowns = maps.flatMap((map, index) => (map.unknownKeyVals ?? []).filter(item => !(index === 0 && item.key.length === 1 && item.key[0] === 0xfb)));
  const proprietaryFieldCount = unknowns.filter(item => item.key[0] === 0xfc).length;
  const metadata = {
    globalXpubCount: count('globalXpub'),
    bip32DerivationCount: count('bip32Derivation'),
    taprootDerivationCount: count('tapBip32Derivation'),
    proprietaryFieldCount,
    unknownFieldCount: unknowns.length - proprietaryFieldCount,
    signatureFieldCount: ['partialSig', 'tapKeySig', 'tapScriptSig', 'finalScriptSig', 'finalScriptWitness'].reduce((total, key) => total + count(key), 0),
    taprootFieldCount: ['tapInternalKey', 'tapMerkleRoot', 'tapLeafScript', 'tapBip32Derivation', 'tapTree', 'tapKeySig', 'tapScriptSig'].reduce((total, key) => total + count(key), 0),
    explicitSighashCount: count('sighashType'),
    proofOfReservesCommitmentCount: count('porCommitment'),
  };
  if (metadata.globalXpubCount) addFinding('XPUB_EXPOSURE', 'warn', 'Global extended public keys are present and may reveal related wallet activity.');
  if (metadata.bip32DerivationCount || metadata.taprootDerivationCount) addFinding('DERIVATION_EXPOSURE', 'warn', 'Key derivation metadata is present and can link this proposal to a wallet.');
  if (metadata.proprietaryFieldCount) addFinding('PROPRIETARY_METADATA', 'warn', 'Proprietary metadata is present; its contents and privacy implications are not interpreted.');
  if (metadata.unknownFieldCount) addFinding('UNKNOWN_METADATA', 'warn', 'Unknown PSBT fields are present and are not interpreted by this inspector.');
  if (metadata.proofOfReservesCommitmentCount) addFinding('POR_COMMITMENT_METADATA', 'warn', 'Proof-of-reserves commitments are present and may contain identifying free-form messages. Their statements are not verified.');
  if (metadata.signatureFieldCount) addFinding('SIGNATURES_NOT_VERIFIED', 'warn', 'Signature or finalization fields are present. Cryptographic validity, coverage, and final transaction behavior are not verified.');
  if (metadata.taprootFieldCount) addFinding('TAPROOT_POLICY_UNCHECKED', 'warn', 'Taproot metadata is present. Script paths, control blocks, and spending policy are outside this inspection.');
  return metadata;
}

/** Read-only preflight: compares supplied PSBT claims to an explicit payment policy. */
export function analyzePsbt({ psbt: payload, intent: rawIntent }) {
  const intent = validateIntent(rawIntent);
  const network = NETWORKS[intent.network];
  const psbt = parsePsbt(payload, network);
  const findings = [];
  const addFinding = (code, severity, message, location = {}) => findings.push({ code, severity, message, ...location });
  const metadata = inspectMetadata(psbt, addFinding);
  const inputOutpoints = new Set();
  let totalKnownInput = 0n;
  const inputs = psbt.data.inputs.map((input, index) => {
    const transactionInput = psbt.txInputs[index];
    const outpoint = `${hex(transactionInput.hash)}:${transactionInput.index}`;
    if (inputOutpoints.has(outpoint)) addFinding('DUPLICATE_INPUT', 'block', 'The unsigned transaction repeats an input outpoint.', { inputIndex: index });
    inputOutpoints.add(outpoint);
    let witness = input.witnessUtxo;
    let previous = null;
    let invalid = false;
    const source = input.nonWitnessUtxo && witness ? 'both' : input.nonWitnessUtxo ? 'nonWitnessUtxo' : witness ? 'witnessUtxo' : 'missing';
    if (input.nonWitnessUtxo) {
      try {
        const transaction = Transaction.fromBuffer(input.nonWitnessUtxo);
        if (!equalBytes(transaction.toBuffer(), input.nonWitnessUtxo)) {
          addFinding('INVALID_PREV_TRANSACTION', 'block', 'The supplied previous transaction uses a non-canonical serialization.', { inputIndex: index });
          invalid = true;
        }
        if (!equalBytes(transaction.getHash(), transactionInput.hash)) {
          addFinding('PREV_TXID_MISMATCH', 'block', 'The supplied previous transaction does not match this input outpoint.', { inputIndex: index });
          invalid = true;
        }
        previous = transaction.outs[transactionInput.index];
        if (!previous) {
          addFinding('PREV_OUTPUT_MISSING', 'block', 'The selected previous transaction output does not exist.', { inputIndex: index });
          invalid = true;
        }
      } catch {
        addFinding('INVALID_PREV_TRANSACTION', 'block', 'The supplied previous transaction cannot be parsed.', { inputIndex: index });
        invalid = true;
      }
    }
    if (witness && previous && (witness.value !== previous.value || !equalBytes(witness.script, previous.script))) {
      addFinding('UTXO_FIELDS_CONFLICT', 'block', 'Witness and non-witness UTXO claims disagree on amount or script.', { inputIndex: index });
      invalid = true;
    }
    const claimed = witness ?? previous;
    if (claimed && (typeof claimed.value !== 'bigint' || claimed.value < 0n || claimed.value > MAX_MONEY_SATS)) {
      addFinding('INPUT_AMOUNT_OUT_OF_RANGE', 'block', 'A supplied input amount exceeds Bitcoin\'s maximum money range.', { inputIndex: index });
      invalid = true;
    }
    const value = !invalid && claimed ? claimed.value : null;
    if (value !== null) totalKnownInput += value;
    if (!claimed && !invalid) addFinding('MISSING_INPUT_VALUE', 'warn', 'This input has no supplied UTXO amount. The total input value and fee cannot be determined.', { inputIndex: index });
    const type = claimed ? scriptType(claimed.script) : 'unknown';
    if (type === 'P2TR' && !metadata.taprootFieldCount) addFinding('TAPROOT_POLICY_UNCHECKED', 'warn', 'A Taproot input is present. Spending policy and script paths are outside this inspection.', { inputIndex: index });
    if (input.sighashType !== undefined && input.sighashType !== (type === 'P2TR' ? 0 : 1)) {
      addFinding('NONDEFAULT_SIGHASH', 'warn', `This input explicitly declares sighash 0x${input.sighashType.toString(16)}. Signature coverage requires independent review.`, { inputIndex: index });
    }
    return { index, valueSats: value?.toString() ?? null, source, scriptType: type, utxoChainVerified: false };
  });
  if (!inputs.length) addFinding('NO_INPUTS', 'block', 'The unsigned transaction has no inputs.');
  if (totalKnownInput > MAX_MONEY_SATS) addFinding('INPUT_TOTAL_OUT_OF_RANGE', 'block', 'The sum of supplied input amounts exceeds Bitcoin\'s maximum money range.');

  const expected = new Map();
  intent.payments.forEach((payment, index) => {
    const script = hex(bitcoinAddress.toOutputScript(payment.address, network));
    const item = expected.get(script) ?? { address: payment.address, expected: 0n, actual: 0n, declarationIndexes: [], outputIndexes: [] };
    item.expected += BigInt(payment.amountSats);
    item.declarationIndexes.push(index);
    expected.set(script, item);
  });
  const changeScripts = new Set(intent.changeAddresses.map(value => hex(bitcoinAddress.toOutputScript(value, network))));
  let totalOutput = 0n;
  const outputs = psbt.txOutputs.map((output, index) => {
    const script = hex(output.script);
    const amount = output.value;
    if (amount < 0n || amount > MAX_MONEY_SATS) addFinding('OUTPUT_AMOUNT_OUT_OF_RANGE', 'block', 'An output amount exceeds Bitcoin\'s maximum money range.', { outputIndex: index });
    totalOutput += amount;
    const payment = expected.get(script);
    const role = payment ? 'payment' : changeScripts.has(script) ? 'change' : 'unexpected';
    if (payment) {
      payment.actual += amount;
      payment.outputIndexes.push(index);
    } else if (role === 'unexpected') addFinding('UNEXPECTED_OUTPUT', 'block', 'An output script is absent from declared payments and explicitly allowed change destinations.', { outputIndex: index });
    let address = null;
    try { address = bitcoinAddress.fromOutputScript(output.script, network); } catch { /* Non-address scripts remain visible locally as script hex. */ }
    return { index, address, scriptHex: script, amountSats: amount.toString(), scriptType: scriptType(output.script), role };
  });
  if (!outputs.length) addFinding('NO_OUTPUTS', 'block', 'The unsigned transaction has no outputs.');
  if (totalOutput > MAX_MONEY_SATS) addFinding('OUTPUT_TOTAL_OUT_OF_RANGE', 'block', 'The sum of output amounts exceeds Bitcoin\'s maximum money range.');
  const payments = Array.from(expected.values(), (payment, index) => {
    if (payment.actual !== payment.expected) addFinding('PAYMENT_AMOUNT_MISMATCH', 'block', `Declared payment group ${index + 1} requires ${payment.expected} sats but its outputs total ${payment.actual} sats.`, { paymentIndex: index });
    return { index, address: payment.address, expectedSats: payment.expected.toString(), actualSats: payment.actual.toString(), declarationIndexes: payment.declarationIndexes, outputIndexes: payment.outputIndexes, matched: payment.actual === payment.expected };
  });
  const allValuesKnown = inputs.length > 0 && inputs.every(input => input.valueSats !== null);
  const fee = allValuesKnown ? totalKnownInput - totalOutput : null;
  if (fee !== null && fee < 0n) addFinding('NEGATIVE_FEE', 'block', 'Outputs exceed supplied input amounts, producing a negative claimed fee.');
  if (fee !== null && fee > BigInt(intent.maxFeeSats)) addFinding('FEE_CAP_EXCEEDED', 'block', `The claimed fee of ${fee} sats exceeds the declared cap of ${intent.maxFeeSats} sats.`);
  addFinding('UTXOS_NOT_CHAIN_VERIFIED', 'info', 'Input values are supplied PSBT claims. No chain lookup verifies their existence, amount, ownership, or unspent status.');
  addFinding('CHANGE_NOT_OWNERSHIP_VERIFIED', 'info', 'Change destinations are accepted only because they were explicitly declared. Wallet ownership is not verified.');
  const blockCount = findings.filter(finding => finding.severity === 'block').length;
  const warningCount = findings.filter(finding => finding.severity === 'warn').length;
  return {
    schemaVersion: '1.0',
    network: intent.network,
    status: blockCount ? 'blocked' : warningCount ? 'review' : 'checks-passed',
    summary: {
      inputCount: inputs.length,
      outputCount: outputs.length,
      totalInputSats: allValuesKnown ? totalKnownInput.toString() : null,
      totalOutputSats: totalOutput.toString(),
      feeSats: fee?.toString() ?? null,
      maxFeeSats: intent.maxFeeSats,
      feeSource: fee === null ? 'unknown' : 'supplied-psbt-claims',
      feeChainVerified: false,
      declaredPaymentCount: intent.payments.length,
      paymentGroupCount: payments.length,
      paymentOutputCount: outputs.filter(output => output.role === 'payment').length,
      changeOutputCount: outputs.filter(output => output.role === 'change').length,
      unexpectedOutputCount: outputs.filter(output => output.role === 'unexpected').length,
      blockCount,
      warningCount,
    },
    inputs, outputs, payments, metadata, findings,
    limitations: [
      'This is an intent and supplied-claim comparison, not a recommendation to sign.',
      'No signatures, spending scripts, wallet ownership, chain state, or transaction relay policy are verified.',
      'Fees use supplied UTXO values; final transaction size and fee rate are not calculated.',
      'The selected network validates and displays addresses; PSBT itself does not encode a network.',
    ],
  };
}

/** Explicit allowlist export. No address, script, outpoint, public key, or raw PSBT is exported. */
export function redactReport(report) {
  const summaryKeys = ['inputCount', 'outputCount', 'totalInputSats', 'totalOutputSats', 'feeSats', 'maxFeeSats', 'feeSource', 'feeChainVerified', 'declaredPaymentCount', 'paymentGroupCount', 'paymentOutputCount', 'changeOutputCount', 'unexpectedOutputCount', 'blockCount', 'warningCount'];
  const metadataKeys = ['globalXpubCount', 'bip32DerivationCount', 'taprootDerivationCount', 'proprietaryFieldCount', 'unknownFieldCount', 'signatureFieldCount', 'taprootFieldCount', 'explicitSighashCount', 'proofOfReservesCommitmentCount'];
  return {
    schemaVersion: report.schemaVersion, redacted: true, network: report.network, status: report.status,
    summary: Object.fromEntries(summaryKeys.map(key => [key, report.summary[key]])),
    inputs: report.inputs.map(({ index, valueSats, source, scriptType, utxoChainVerified }) => ({ index, valueSats, source, scriptType, utxoChainVerified })),
    outputs: report.outputs.map(({ index, amountSats, scriptType, role }) => ({ index, amountSats, scriptType, role })),
    payments: report.payments.map(({ index, expectedSats, actualSats, declarationIndexes, outputIndexes, matched }) => ({ index, expectedSats, actualSats, declarationIndexes, outputIndexes, matched })),
    metadata: Object.fromEntries(metadataKeys.map(key => [key, report.metadata[key]])),
    findings: report.findings.map(({ code, severity, message, inputIndex, outputIndex, paymentIndex }) => ({ code, severity, message, ...(inputIndex === undefined ? {} : { inputIndex }), ...(outputIndex === undefined ? {} : { outputIndex }), ...(paymentIndex === undefined ? {} : { paymentIndex }) })),
    limitations: [...report.limitations],
    redactionNotice: 'Addresses, scripts, outpoints, public keys, and raw payload are excluded. Amounts, counts, field presence, and output order remain; this is not an anonymity guarantee.',
  };
}
