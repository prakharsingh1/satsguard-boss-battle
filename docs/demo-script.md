# SatsGuard narrated demo

Actual app captures and actual CLI output, using synthetic testnet fixtures. No live cursor or fabricated interaction. Captions are burned into the video. Narration uses macOS Samantha; AI-assisted prototype and AI narration are disclosed on every frame.

### 00:00:00,000 — SatsGuard · BOSS Battle 2026

A Bitcoin proposal can have a plausible fee and still pay the wrong person. SatsGuard compares a partially signed Bitcoin transaction with the payment you meant to make. This AI-assisted prototype was built for Prakhar Singh. These are actual app captures using synthetic testnet fixtures.

### 00:00:17,611 — 01 · Explicit intent

The policy declares the network, recipients, exact satoshi amounts, allowed change addresses, and an absolute fee cap. You can paste or load a base sixty-four or hex PSBT. Change is accepted only when you declare it. The app does not guess which outputs belong to your wallet.

### 00:00:36,086 — 02 · Recipient swap

In the recipient-swap example, the claimed fee is only one thousand sats. But fifty thousand sats go to an undeclared destination. SatsGuard marks that output and reports a payment amount mismatch: the intended recipient receives zero. The allocation map makes this difference visible instead of burying it in raw transaction data.

### 00:00:56,786 — 03 · Matched example

Now compare the matched example. The same supplied one hundred thousand sats become fifty thousand for the declared payment, forty-nine thousand for declared change, and a one-thousand-sat fee. No declared checks failed means the policy comparison passed. It does not mean the transaction is safe to sign.

### 00:01:15,763 — 04 · Fee spike

The fee-spike fixture still pays the expected recipient. But its supplied input and output values imply a ten-thousand-sat fee, above the two-thousand-sat cap. The report fails the fee check. Accounting uses whole satoshis and supplied PSBT values, with the source of those values stated in the report.

### 00:01:35,060 — 05 · Missing input value

Remove the supplied input value and the recipients still match, but the fee becomes unknown. The app requests review because it cannot check the cap. This example was also rerun with the browser network disabled after loading. Analysis stays local and makes no chain lookup or payload upload.

### 00:01:52,901 — 06 · CLI and redacted evidence

The command-line interface runs the same deterministic engine. Here is an actual recipient-swap run: blocked status, a one-thousand-sat fee, and one unexpected output. The JSON export excludes addresses, scripts, outpoints, public keys, and raw payloads. Amounts and transaction shape remain, so redaction is not an anonymity guarantee. No AI model is integrated.

### 00:02:17,763 — SatsGuard · Prototype scope

SatsGuard is a small PSBT version-zero preflight prototype, not a wallet or an audited security system. It does not verify signatures, ownership, spendability, or chain state. It never asks for keys, signs, or broadcasts. The goal is a reviewable comparison between declared intent and the proposal in front of you.

## Rebuild

Run `python3 output/render_demo.py` on macOS with Python/Pillow, ffmpeg, ffprobe, and the Samantha voice. It uses no network and reads the actual screenshot files in `output/`.
