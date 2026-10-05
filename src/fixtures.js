import { Psbt, payments, networks } from 'bitcoinjs-lib';

const networkFor = name => name === 'bitcoin' ? networks.bitcoin : networks.testnet;
const bytesFromHex = value => Uint8Array.from(value.match(/.{2}/g), pair => Number.parseInt(pair, 16));
const destination = (fill, network = networks.testnet) => payments.p2wpkh({ hash: new Uint8Array(20).fill(fill), network });

/** Synthetic destinations use fixed public-key hashes. No private keys or real UTXOs are used. */
export const DEMO_ADDRESSES = Object.freeze({
  payment: destination(0x22).address,
  change: destination(0x33).address,
  unexpected: destination(0x44).address,
});

/**
 * Deterministic synthetic PSBT generator for tests and local demos.
 * Values are decimal strings, and a null/omitted input value omits its UTXO claim.
 * Generated outpoints do not claim to exist on a chain.
 */
export function buildPsbt({ network = 'testnet', inputs, outputs, version = 2, locktime = 0 }) {
  const selectedNetwork = networkFor(network);
  const psbt = new Psbt({ network: selectedNetwork });
  psbt.setVersion(version);
  psbt.setLocktime(locktime);
  inputs.forEach((input, index) => {
    const fields = {
      hash: input.hash ?? new Uint8Array(32).fill(index + 0x11),
      index: input.index ?? 0,
      sequence: input.sequence ?? 0xffffffff,
    };
    if (input.valueSats !== null && input.valueSats !== undefined) {
      fields.witnessUtxo = {
        value: BigInt(input.valueSats),
        script: input.scriptHex ? bytesFromHex(input.scriptHex) : destination(0x11, selectedNetwork).output,
      };
    }
    if (input.nonWitnessUtxo) fields.nonWitnessUtxo = input.nonWitnessUtxo;
    if (input.sighashType !== undefined) fields.sighashType = input.sighashType;
    psbt.addInput(fields);
  });
  outputs.forEach(output => {
    const fields = { value: BigInt(output.amountSats) };
    if (output.scriptHex) fields.script = bytesFromHex(output.scriptHex);
    else fields.address = output.address;
    psbt.addOutput(fields);
  });
  return psbt.toBase64();
}

export const DEMO_INTENT = Object.freeze({
  network: 'testnet',
  payments: [{ address: DEMO_ADDRESSES.payment, amountSats: '50000' }],
  changeAddresses: [DEMO_ADDRESSES.change],
  maxFeeSats: '2000',
});

const fixture = (id, name, description, outputs, valueSats = '100000') => ({
  id, name, description,
  synthetic: true,
  psbt: buildPsbt({
    inputs: [{ valueSats }],
    outputs,
  }),
  intent: JSON.parse(JSON.stringify(DEMO_INTENT)),
});

export const DEMO_FIXTURES = [
  fixture('matched-intent', 'Matched intent', 'Synthetic proposal: 50,000 sats to the declared recipient, 49,000 sats to declared change, and a 1,000-sat claimed fee.', [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ]),
  fixture('fee-spike', 'Fee spike', 'Synthetic proposal: the recipient still matches, but the 10,000-sat claimed fee exceeds the declared 2,000-sat cap.', [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '40000' },
  ]),
  fixture('recipient-swap', 'Recipient swap', 'Synthetic proposal: 50,000 sats go to an undeclared destination instead of the intended recipient.', [
    { address: DEMO_ADDRESSES.unexpected, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ]),
  fixture('missing-values', 'Missing input value', 'Synthetic proposal: recipients match, but the input carries no UTXO amount, so the fee cap cannot be checked.', [
    { address: DEMO_ADDRESSES.payment, amountSats: '50000' },
    { address: DEMO_ADDRESSES.change, amountSats: '49000' },
  ], null),
];
