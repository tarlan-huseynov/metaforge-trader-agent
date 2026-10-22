import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, jobPayload, installPayload, inventoryJob, pollPayload, runtimeSource } from '../src/lib/driver.js';

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
