import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

/** Each case gets a throwaway data dir seeded with the real item cache. */
const sandbox = (listings = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-test-'));
  fs.copyFileSync(path.join(root, 'data', 'items.json'), path.join(dir, 'items.json'));
  fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify({ schema: 2, listings }));
  fs.writeFileSync(path.join(dir, 'audit.jsonl'), '');
  return dir;
};

const cli = (dir, ...args) =>
  execFileSync(process.execPath, [path.join(root, 'src', 'cli.js'), ...args], {
    env: { ...process.env, MF_DATA_DIR: dir },
    encoding: 'utf8',
  });

const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'listings.json'), 'utf8'));

test('add writes a draft with structured price', () => {
  const dir = sandbox();
  cli(dir, 'add', 'barricade kit bp for 2 kinetics', '--note', '1 bp for 2 kinetics');
  const [row] = read(dir).listings;
  assert.equal(row.status, 'draft');
  assert.equal(row.item.name, 'Barricade Kit Blueprint');
  assert.deepEqual(row.price, { kind: 'items', items: [{ name: 'Kinetic Converter', quantity: 2 }] });
  assert.equal(row.note, '1 bp for 2 kinetics');
});

test('duplicate trades are skipped, not posted twice', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics');
  const output = cli(dir, 'add', 'anvil bp for 2 kinetics');
  assert.match(output, /skipped/);
  assert.equal(read(dir).listings.length, 1);
});

test('a different price is not a duplicate', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics');
  cli(dir, 'add', 'anvil bp for 3 kinetics');
  assert.equal(read(dir).listings.length, 2);
});

test('status machine blocks illegal moves', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics');
  const id = read(dir).listings[0].id;
  assert.throws(() => cli(dir, 'submitted', '--id', id, '--remote-id', 'x'), /Cannot submitted/);
  cli(dir, 'approve', '--id', id);
  assert.throws(() => cli(dir, 'submitted', '--id', id), /requires --remote-id/);
  cli(dir, 'submitted', '--id', id, '--remote-id', 'verified:row-text');
  assert.equal(read(dir).listings[0].status, 'published');
});

test('commit payloads refuse unapproved listings', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics');
  assert.throws(() => cli(dir, 'payload:create', '--status', 'draft', '--commit'), /Refusing to commit unapproved/);
});

test('dry-run payloads are allowed for drafts and stay one line', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics');
  const payload = cli(dir, 'payload:create', '--status', 'draft', '--quiet').trim();
  assert.equal(payload.split('\n').length, 1);
  assert.match(payload, /"commit":false/);
  assert.match(payload, /"quantity":2/);
  assert.ok(payload.length < 600, `payload should stay tiny, was ${payload.length} bytes`);
});

test('v1 listings migrate into structured prices', () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify([
    { id: '11111111-1111-4111-8111-111111111111', item: 'Anvil Blueprint', quantity: 1, offer: '1 Anvil Blueprint', want: '2 Kinetic Converter', notes: 'n', status: 'approved', remoteId: null, createdAt: 'x', updatedAt: 'x' },
  ]));
  cli(dir, 'migrate');
  const [row] = read(dir).listings;
  assert.deepEqual(row.price, { kind: 'items', items: [{ name: 'Kinetic Converter', quantity: 2 }] });
  assert.equal(row.status, 'approved');
});

test('apply-result publishes verified rows and flags the rest', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics', 'bettina bp for 2 kinetics');
  const [a, b] = read(dir).listings.map((row) => row.id);
  cli(dir, 'approve', '--status', 'draft');
  cli(dir, 'apply-result', '--json', JSON.stringify({
    done: true,
    results: [
      { id: a, ok: true, evidence: ['Anvil Blueprint 2x Kinetic Converter'] },
      { id: b, ok: false, problems: ['quantity 12 != 2'] },
    ],
  }));
  const rows = read(dir).listings;
  assert.equal(rows.find((r) => r.id === a).status, 'published');
  assert.equal(rows.find((r) => r.id === b).status, 'needs_review');
});

test('audit log records every state change', () => {
  const dir = sandbox();
  cli(dir, 'add', 'anvil bp for 2 kinetics');
  cli(dir, 'approve', '--status', 'draft');
  const lines = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.action), ['add', 'approve']);
});
