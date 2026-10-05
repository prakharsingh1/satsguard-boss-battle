import './style.css';
import { analyzePsbt, redactReport, validateIntent } from './engine.js';
import { DEMO_FIXTURES } from './fixtures.js';

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sats = value => value === null || value === undefined ? 'Unknown' : BigInt(value).toLocaleString('en-US');
let currentReport = null;
let toastTimer;

function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role', 'status'); node.textContent = message;
  document.body.append(node); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.remove(), 2800);
}
function addPayment(address = '', amount = '') {
  const row = document.createElement('div'); row.className = 'payment-row';
  row.innerHTML = `<input class="payment-address" aria-label="Payment address" placeholder="Recipient address" autocomplete="off" spellcheck="false"><input class="payment-amount" aria-label="Payment amount in sats" placeholder="sats" inputmode="numeric" autocomplete="off"><button class="remove-payment" type="button" aria-label="Remove payment">×</button>`;
  row.querySelector('.payment-address').value = address; row.querySelector('.payment-amount').value = amount;
  row.querySelector('button').addEventListener('click', () => { row.remove(); markStale(); });
  $('payments').append(row);
}
function collectIntent() {
  return {network:$('network').value,payments:[...document.querySelectorAll('.payment-row')].map(row => ({address:row.querySelector('.payment-address').value.trim(),amountSats:row.querySelector('.payment-amount').value.trim()})),changeAddresses:$('change-addresses').value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean),maxFeeSats:$('max-fee').value.trim()};
}
function populateIntent(intent) {
  $('network').value = intent.network; $('max-fee').value = intent.maxFeeSats; $('payments').replaceChildren();
  if (!Array.isArray(intent.payments) || !Array.isArray(intent.changeAddresses)) throw new Error('Intent must contain payments and changeAddresses arrays.');
  intent.payments.forEach(payment => addPayment(payment.address, payment.amountSats));
  $('change-addresses').value = intent.changeAddresses.join('\n'); $('intent-json').value = JSON.stringify(intent,null,2);
}
function markStale() {
  if (currentReport) { $('stale-banner').hidden = false; $('export').disabled = true; }
  $('scenario').value = ''; $('scenario-description').textContent = 'Your data stays in this page. No accounts or keys are needed.';
}
function inputError(error) { $('input-error').textContent = error instanceof Error ? error.message : String(error); $('input-error').hidden = false; }
function renderReport(report) {
  currentReport = report; $('stale-banner').hidden = true; $('input-error').hidden = true;
  document.querySelector('.results-panel').dataset.status = report.status;
  const titles = {blocked:'Declared checks failed',review:'Review required','checks-passed':'No declared checks failed'};
  const details = {blocked:'Resolve the flagged intent or accounting conflicts before considering this transaction.',review:'The supplied data needs attention. Read the observations below.','checks-passed':'Outputs match the declared intent and the supplied fee is within your limit.'};
  $('result-title').textContent = titles[report.status] || 'Preflight complete'; $('result-detail').textContent = details[report.status] || '';
  $('status-symbol').textContent = {blocked:'!',review:'?', 'checks-passed':'✓'}[report.status];
  $('stat-input').innerHTML = `${sats(report.summary.totalInputSats)}${report.summary.totalInputSats === null ? '' : '<small>sats</small>'}`;
  $('stat-output').innerHTML = `${sats(report.summary.totalOutputSats)}<small>sats</small>`;
  $('stat-fee').innerHTML = `${sats(report.summary.feeSats)}${report.summary.feeSats === null ? '' : '<small>sats</small>'}`;
  $('network-label').textContent = `${report.network === 'bitcoin' ? 'MAINNET' : 'TESTNET / SIGNET'} · ${report.summary.inputCount} IN / ${report.summary.outputCount} OUT`;
  const outputRows = report.outputs.map((out,i) => `<div class="flow-row"><div class="flow-source">${i === 0 ? `${report.summary.inputCount} supplied input${report.summary.inputCount === 1 ? '' : 's'}<strong>${sats(report.summary.totalInputSats)} sats</strong>` : '↳ allocation'}</div><div class="flow-line"></div><div class="flow-output ${escapeHtml(out.role)}"><div class="output-top"><span>${out.role === 'payment' ? 'Expected payment' : out.role === 'change' ? 'Declared change' : 'Unexpected output'} <span class="light">#${out.index}</span></span><strong>${sats(out.amountSats)} sats</strong></div><div class="output-address">${escapeHtml(out.address || 'Non-address script · inspect source report')}</div></div></div>`);
  outputRows.push(`<div class="flow-row"><div class="flow-source">↳ difference</div><div class="flow-line"></div><div class="flow-output fee"><div class="output-top"><span>Fee <span class="light">limit ${sats(report.summary.maxFeeSats)} sats</span></span><strong>${sats(report.summary.feeSats)}${report.summary.feeSats === null ? '' : ' sats'}</strong></div><div class="output-address">${report.summary.feeSats === null ? 'Input values are incomplete. Fee cannot be computed.' : 'Computed from supplied PSBT values · not chain verified'}</div></div></div>`);
  $('flow').innerHTML = outputRows.join('');
  const findings = report.findings || []; const failures = findings.filter(f=>f.severity==='block').length; const warnings = findings.filter(f=>f.severity==='warn').length;
  $('finding-count').textContent = `${failures} failed · ${warnings} to review`;
  $('findings').innerHTML = findings.length ? findings.map(f=>`<div class="finding ${escapeHtml(f.severity)}"><span class="finding-symbol">${f.severity === 'block' ? '!' : f.severity === 'warn' ? '?' : 'i'}</span><div><strong>${escapeHtml(f.code.replace(/_/g,' ').replace(/-/g,' ').toLowerCase())}</strong><p>${escapeHtml(f.message)}</p></div></div>`).join('') : '<div class="finding info"><span class="finding-symbol">✓</span><div><strong>Intent and fee checks completed</strong><p>No declared checks failed. Independently verify the transaction in a trusted signer.</p></div></div>';
  $('export').disabled = false; $('intent-json').value = JSON.stringify(collectIntent(),null,2);
}
function runPreflight() {
  try { renderReport(analyzePsbt({psbt:$('psbt').value.trim(),intent:collectIntent()})); }
  catch(error) { inputError(error); currentReport = null; $('export').disabled = true; $('stale-banner').hidden = true; document.querySelector('.results-panel').dataset.status = 'blocked'; $('result-title').textContent = 'Unable to inspect'; $('result-detail').textContent = 'Fix the input error and run preflight again.'; $('status-symbol').textContent = '!'; ['stat-input','stat-output','stat-fee'].forEach(id=>$(id).textContent='—'); $('flow').innerHTML='<div class="empty-state"><p>No report was produced. Previous results have been cleared.</p></div>'; $('findings').replaceChildren(); $('finding-count').textContent='—'; $('network-label').textContent='NO REPORT'; }
}
function download(name,text) { const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url); }
DEMO_FIXTURES.forEach(f=>{const option=document.createElement('option');option.value=f.id;option.textContent=f.name;$('scenario').append(option);});
$('scenario').addEventListener('change',()=>{const fixture=DEMO_FIXTURES.find(f=>f.id===$('scenario').value);if(!fixture)return;$('psbt').value=fixture.psbt;populateIntent(fixture.intent);$('scenario-description').textContent=fixture.description;runPreflight();});
$('analyze').addEventListener('click',runPreflight);
$('add-payment').addEventListener('click',()=>{addPayment();markStale();});
$('payments').addEventListener('input',markStale);
['psbt','network','max-fee','change-addresses'].forEach(id=>$(id).addEventListener('input',markStale));
$('apply-json').addEventListener('click',()=>{try{const intent=validateIntent(JSON.parse($('intent-json').value));populateIntent(intent);markStale();$('input-error').hidden=true;toast('Intent applied. Run preflight to check it.');}catch(error){inputError(error);}});
$('psbt-file').addEventListener('change',async()=>{try{const file=$('psbt-file').files[0];if(!file)return;if(file.size>1_000_000)throw new Error('Use a file smaller than 1 MB. The parsed PSBT limit is also 1 MB.');const bytes=new Uint8Array(await file.arrayBuffer());$('psbt').value=bytes[0]===0x70&&bytes[1]===0x73&&bytes[2]===0x62&&bytes[3]===0x74?Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''):new TextDecoder().decode(bytes);markStale();$('input-error').hidden=true;}catch(error){inputError(error);}finally{$('psbt-file').value='';}});
$('export').addEventListener('click',()=>{if(!currentReport||!$('stale-banner').hidden)return;download('satsguard-redacted-report.json',JSON.stringify(redactReport(currentReport),null,2));toast('Redacted report downloaded. Amounts and findings remain.');});
$('copy-intent').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(collectIntent(),null,2));toast('Intent JSON copied. It includes addresses and amounts.');}catch{$('intent-json').value=JSON.stringify(collectIntent(),null,2);document.querySelector('.json-intent').open=true;$('intent-json').focus();$('intent-json').select();toast('Select and copy the intent JSON below the form.');}});
$('clear').addEventListener('click',()=>{$('psbt').value='';$('payments').replaceChildren();addPayment();$('change-addresses').value='';$('intent-json').value='';$('scenario').value='';$('scenario-description').textContent='Examples contain invented transaction data, not real funds.';currentReport=null;$('export').disabled=true;$('input-error').hidden=true;$('stale-banner').hidden=true;document.querySelector('.results-panel').removeAttribute('data-status');$('result-title').textContent='Ready to inspect';$('result-detail').textContent='Choose an example or paste a PSBT and declare your intent.';$('status-symbol').textContent='◎';['stat-input','stat-output','stat-fee','finding-count'].forEach(id=>$(id).textContent='—');$('network-label').textContent='NO REPORT YET';$('flow').innerHTML='<div class="empty-state"><span>↳</span><p>The output map appears here.<br>Nothing is inferred as your change.</p></div>';$('findings').innerHTML='<p class="hint empty-findings">Intent, fee and metadata checks will appear here.</p>';toast('Page inputs and report cleared. Nothing was saved.');});
const initial = DEMO_FIXTURES.find(f=>f.id==='recipient-swap') || DEMO_FIXTURES[0];
if(initial){$('scenario').value=initial.id;$('psbt').value=initial.psbt;populateIntent(initial.intent);$('scenario-description').textContent=initial.description;runPreflight();}else{addPayment();}
