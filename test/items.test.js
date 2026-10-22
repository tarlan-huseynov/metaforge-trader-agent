import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, resolve, isSeeds, filterItems } from '../src/lib/items.js';

const index = buildIndex();

test('shorthand resolves to canonical cached names', () => {
  assert.equal(resolve('snap hook bp', index).exact, 'Snap Hook Blueprint');
  assert.equal(resolve('2 kinetics', index).exact, 'Kinetic Converter');
  assert.equal(resolve('kc', index).exact, 'Kinetic Converter');
});

test('thin margins are reported as ambiguous rather than guessed', () => {
  const hit = resolve('hook', index);
  assert.equal(hit.exact, null);
  assert.ok(hit.candidates.length >= 2);
});

test('unknown items never resolve', () => {
  assert.equal(resolve('plasma unicorn cannon', index).exact, null);
});

test('seed aliases are recognised as currency', () => {
  for (const phrase of ['seeds', 'Seeds', 'assorted seeds', '300 seeds']) assert.ok(isSeeds(phrase), phrase);
  assert.equal(isSeeds('Kinetic Converter'), false);
});

test('category filter only returns cached names', () => {
  const blueprints = filterItems({ category: 'blueprint' }, index);
  assert.ok(blueprints.every((item) => item.name.includes('Blueprint')));
});
