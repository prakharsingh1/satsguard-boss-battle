#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { analyzePsbt, redactReport, SatsGuardError } from '../src/engine.js';
import { DEMO_FIXTURES } from '../src/fixtures.js';

const usage = `SatsGuard — read-only PSBT intent preflight

Usage:
  node scripts/cli.mjs --psbt proposal.psbt --intent intent.json
  node scripts/cli.mjs --psbt - --intent intent.json
  node scripts/cli.mjs --demo matched-intent

PSBT files contain base64 or hex text. '-' reads PSBT text from stdin.
stdout is a redacted JSON report; no identifiers or raw PSBT are exported.
Exit 0: no declared checks failed; 1: review warnings; 2: blocked or invalid input.
No signing, broadcasting, chain lookup, key access, or network requests occur.
`;

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' || key === '-h') return { help: true };
    if (!['--psbt', '--intent', '--demo'].includes(key) || options[key] !== undefined || !args[i + 1]) {
      throw new SatsGuardError('INVALID_ARGUMENTS', 'Use --psbt and --intent, or --demo with a fixture ID. See --help.');
    }
    options[key] = args[++i];
  }
  if (options['--demo']) {
    if (options['--psbt'] || options['--intent']) throw new SatsGuardError('INVALID_ARGUMENTS', 'Use --demo by itself.');
  } else if (!options['--psbt'] || !options['--intent']) {
    throw new SatsGuardError('INVALID_ARGUMENTS', 'Both --psbt and --intent are required. See --help.');
  }
  return options;
}

async function readText(path) {
  if (path === '-') {
    process.stdin.setEncoding('utf8');
    let text = '';
    for await (const chunk of process.stdin) {
      text += chunk;
      if (text.length > 3_000_000) throw new SatsGuardError('PSBT_TOO_LARGE', 'PSBT exceeds the 1 MB local inspection limit.');
    }
    return text;
  }
  try { return await readFile(path, 'utf8'); }
  catch { throw new SatsGuardError('FILE_READ_FAILED', 'Could not read an input file. Check the file exists and is readable.'); }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
  } else {
    let input;
    if (options['--demo']) {
      const fixture = DEMO_FIXTURES.find(item => item.id === options['--demo']);
      if (!fixture) throw new SatsGuardError('INVALID_ARGUMENTS', 'Unknown demo ID. Use matched-intent, fee-spike, recipient-swap, or missing-values.');
      input = { psbt: fixture.psbt, intent: fixture.intent };
    } else {
      const [psbt, intentText] = await Promise.all([readText(options['--psbt']), readText(options['--intent'])]);
      let intent;
      try { intent = JSON.parse(intentText); }
      catch { throw new SatsGuardError('INVALID_INTENT', 'Intent file is not valid JSON.'); }
      input = { psbt, intent };
    }
    const report = analyzePsbt(input);
    process.stdout.write(`${JSON.stringify(redactReport(report), null, 2)}\n`);
    process.exitCode = report.status === 'blocked' ? 2 : report.status === 'review' ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: error instanceof SatsGuardError ? error.code : 'INSPECTION_FAILED', message: error instanceof SatsGuardError ? error.message : 'Inspection failed; no report was produced.' } })}\n`);
  process.exitCode = 2;
}
