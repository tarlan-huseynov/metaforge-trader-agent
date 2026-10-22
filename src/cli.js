import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = path.resolve('data/listings.json');
const auditPath = path.resolve('data/audit.jsonl');
const itemsPath = path.resolve('data/items.json');
const command = process.argv[2] ?? 'list';
const args = process.argv.slice(3);
const get = (flag) => { const i = args.indexOf(`--${flag}`); return i < 0 ? undefined : args[i + 1]; };
const fail = (message) => { console.error(message); process.exit(1); };
const read = () => JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const write = (rows) => { const tmp = `${dbPath}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, dbPath); };
const log = (action, record) => fs.appendFileSync(auditPath, JSON.stringify({ timestamp: new Date().toISOString(), action, id: record.id, status: record.status }) + '\n', { mode: 0o600 });
const id = () => crypto.randomUUID();
const requireString = (value, name) => { if (!value?.trim()) fail(`Missing --${name}`); return value.trim(); };
const positiveInteger = (value, name) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) fail(`--${name} must be a positive integer`); return n; };
const readItems = () => JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
const writeItems = (data) => { const tmp = `${itemsPath}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, itemsPath); };

if (command === 'cache-find') {
  const query = requireString(get('query'), 'query').toLowerCase();
  const matches = readItems().items.filter((i) => i.name.toLowerCase().includes(query));
  console.log(JSON.stringify(matches, null, 2));
  process.exit(0);
}
if (command === 'cache-add') {
  const name = requireString(get('name'), 'name');
  const category = get('category') ?? '';
  const data = readItems();
  if (data.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) fail(`Already cached: ${name}`);
  data.items.push({ name, category, seenAt: new Date().toISOString().slice(0, 10) });
  data._meta.updatedAt = new Date().toISOString().slice(0, 10);
  writeItems(data);
  console.log(`Cached: ${name}`);
  process.exit(0);
}

const rows = read();
if (command === 'add') {
  const item = requireString(get('item'), 'item');
  const quantity = positiveInteger(get('quantity'), 'quantity');
  const offer = requireString(get('offer'), 'offer');
  const want = requireString(get('want'), 'want');
  const record = { id: id(), item, quantity, offer, want, notes: get('notes') ?? '', status: 'draft', remoteId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  rows.push(record); write(rows); log('add', record); console.log(JSON.stringify(record, null, 2));
} else if (['approve', 'submitted', 'fail'].includes(command)) {
  const record = rows.find((r) => r.id === get('id'));
  if (!record) fail('Listing ID not found');
  const next = { approve: 'approved', submitted: 'published', fail: 'needs_review' }[command];
  const allowed = { approve: ['draft', 'needs_review'], submitted: ['approved'], fail: ['approved'] }[command];
  if (!allowed.includes(record.status)) fail(`Cannot ${command} listing with status ${record.status}`);
  if (command === 'submitted') record.remoteId = requireString(get('remote-id'), 'remote-id');
  record.status = next; record.updatedAt = new Date().toISOString(); write(rows); log(command, record); console.log(JSON.stringify(record, null, 2));
} else if (command === 'show') {
  const record = rows.find((r) => r.id === get('id'));
  if (!record) fail('Listing ID not found');
  console.log(JSON.stringify(record, null, 2));
} else if (command === 'list') {
  console.table(rows.map(({ id, item, quantity, offer, want, status, remoteId }) => ({ id, item, quantity, offer, want, status, remoteId })));
} else {
  fail('Commands: list, add, approve, submitted, fail, show, cache-find, cache-add');
}
