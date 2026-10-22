import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, jobPayload, installPayload, inventoryJob, listingsJob, delistJob, pollPayload, resultPayload, runtimeSource } from '../src/lib/driver.js';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  side: 'sell',
  item: { name: 'Anvil Blueprint', quantity: 3 },
  price: { kind: 'items', items: [{ name: 'Kinetic Converter', quantity: 2 }] },
  perUnit: true,
  note: 'each',
};

test('the job carries resolved totals, not per-unit prices', () => {
  const [spec] = createJob([row]).specs;
  assert.deepEqual(spec.form, { kind: 'items', items: [{ name: 'Kinetic Converter', quantity: 6 }] });
  assert.equal(spec.item.quantity, 3);
});

test('a job payload is one line and degrades safely without the runtime', () => {
  const payload = jobPayload(createJob([row]));
  assert.equal(payload.includes('\n'), false);
  assert.match(payload, /needsInstall: true/);
});

test('dry run is the default; commit must be asked for', () => {
  assert.match(jobPayload(createJob([row])), /"commit":false/);
  assert.match(jobPayload(createJob([row], { commit: true })), /"commit":true/);
});

test('inventory and poll payloads are self-contained', () => {
  assert.match(jobPayload(inventoryJob()), /"kind":"inventory"/);
  assert.match(pollPayload().action_script, /__MF_JOB/);
});

test('the install payload is a single evaluable expression', () => {
  const source = installPayload();
  assert.equal(source, runtimeSource());
  assert.match(source.trimEnd(), /\)\(\)$/);
  // browser_execute_script evaluates an expression: a top-level return would throw.
  assert.doesNotMatch(source, /^return /m);
});

test('the runtime never clicks a quantity stepper', () => {
  const source = runtimeSource();
  assert.doesNotMatch(source, /Increase .*quantity/i);
  assert.doesNotMatch(source, /Decrease .*quantity/i);
  assert.match(source, /desc\.set\.call/);
});

test('a delist job names the rows and nothing else', () => {
  const [spec] = delistJob([row]).specs;
  assert.deepEqual(spec, { id: row.id, name: 'Anvil Blueprint' });
});

test('delist and listings payloads are one line and degrade without the runtime', () => {
  for (const payload of [jobPayload(delistJob([row])), jobPayload(listingsJob())]) {
    assert.equal(payload.includes('\n'), false);
    assert.match(payload, /needsInstall: true/);
  }
});

test('the result payload is one line and drops the fields nothing reads', () => {
  const payload = resultPayload();
  assert.equal(payload.includes('\n'), false);
  for (const kept of ['id', 'ok', 'evidence', 'problems', 'delist', 'chats']) {
    assert.match(payload, new RegExp(`\\b${kept}\\b`));
  }
  assert.doesNotMatch(payload, /bodyText/);
});

test('the runtime answers both new job kinds and keeps the two-step remove', () => {
  const source = runtimeSource();
  assert.match(source, /job\.kind === 'delist'/);
  assert.match(source, /job\.kind === 'listings'/);
  // The row button only opens the confirmation; the dialog's own Remove commits it.
  assert.match(source, /\^remove listing\$/i);
  assert.match(source, /buttonByText\(\/\^Remove\$\/i, anyDialog\(\)\)/);
});

test('the runtime spells no non-ASCII character: escapes do not survive the bridge', () => {
  const source = runtimeSource();
  // A \uXXXX escape was observed arriving in the page as literal backslash-u,
  // which silently turns a regex or a split into one that never matches.
  assert.doesNotMatch(source, /\\u[0-9a-fA-F]{4}/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(source, /[^\x00-\x7F]/);
});
