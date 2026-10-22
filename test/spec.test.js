import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/lib/items.js';
import { parseTrade, formTotals, fingerprint, makeSpec, SpecError } from '../src/lib/spec.js';

const index = buildIndex();
const parse = (phrase) => parseTrade(phrase, { index });

test('the regression that caused 12 instead of 2: one unit, barter price', () => {
  const spec = parse('barricade kit bp for 2 kinetics');
  assert.equal(spec.item.quantity, 1);
  assert.deepEqual(formTotals(spec), { kind: 'items', items: [{ name: 'Kinetic Converter', quantity: 2 }] });
});

test('per-unit prices multiply exactly once', () => {
  const spec = parse('3 anvil bps for 2 kinetics each');
  assert.deepEqual(formTotals(spec).items, [{ name: 'Kinetic Converter', quantity: 6 }]);
  assert.deepEqual(formTotals(formTotals(spec) && spec).items, [{ name: 'Kinetic Converter', quantity: 6 }]);
});

test('total pricing is not multiplied', () => {
  const spec = parse('3 anvil bps for 6 kinetics total');
  assert.equal(spec.perUnit, false);
  assert.deepEqual(formTotals(spec).items, [{ name: 'Kinetic Converter', quantity: 6 }]);
});

test('seed prices parse and scale', () => {
  assert.deepEqual(formTotals(parse('snap hook bp for 300 seeds')), { kind: 'seeds', amount: 300 });
  assert.deepEqual(formTotals(parse('2 snap hook bps for 300 seeds each')), { kind: 'seeds', amount: 600 });
});

test('buy side is detected', () => {
  assert.equal(parse('buy 5 kinetics for 100 seeds each').side, 'buy');
  assert.equal(parse('snap hook bp for 300 seeds').side, 'sell');
});

test('offers listings carry no price', () => {
  assert.deepEqual(formTotals(parse('snap hook bp for offers')), { kind: 'offers' });
});

test('multi-item barter is supported, mixed currency is not', () => {
  const spec = parse('snap hook bp for 2 kinetics + 1 anvil blueprint');
  assert.equal(formTotals(spec).items.length, 2);
  assert.throws(() => parse('snap hook bp for 2 kinetics + 100 seeds'), SpecError);
});

test('bad input fails loudly instead of guessing', () => {
  assert.throws(() => parse('snap hook bp'), SpecError);
  assert.throws(() => parse('hook for 2 kinetics'), SpecError);
  assert.throws(() => parse('mystery item for 2 kinetics'), SpecError);
  assert.throws(() => makeSpec({ side: 'sell', itemName: 'X', quantity: 0, price: { kind: 'seeds', amount: 1 } }), SpecError);
  assert.throws(() => makeSpec({ side: 'sell', itemName: 'X', quantity: 1, price: { kind: 'seeds', amount: -5 } }), SpecError);
});

test('fingerprints match on identical trades and differ on price', () => {
  assert.equal(fingerprint(parse('anvil bp for 2 kinetics')), fingerprint(parse('1 Anvil Blueprint for 2 Kinetic Converter')));
  assert.notEqual(fingerprint(parse('anvil bp for 2 kinetics')), fingerprint(parse('anvil bp for 3 kinetics')));
});
