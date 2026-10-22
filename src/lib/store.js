import crypto from 'node:crypto';
import { readJson, writeJson } from './json.js';
import { listingsPath } from './paths.js';
import { audit } from './audit.js';
import { fingerprint, formTotals, validatePrice } from './spec.js';

export const SCHEMA = 2;

/** draft -> approved -> published, with needs_review as the manual-attention bucket. */
const TRANSITIONS = {
  approve: { to: 'approved', from: ['draft', 'needs_review'] },
  submitted: { to: 'published', from: ['approved'] },
  fail: { to: 'needs_review', from: ['approved', 'draft'] },
  reset: { to: 'draft', from: ['needs_review'] },
};
export { TRANSITIONS };

class StoreError extends Error {}
export { StoreError };

/** v1 stored a flat array with free-text offer/want strings. Convert once, keep the text. */
const migrate = (raw) => {
  if (Array.isArray(raw)) {
    return {
      schema: SCHEMA,
      listings: raw.map((row) => ({
        id: row.id,
        side: 'sell',
        item: { name: row.item, quantity: row.quantity ?? 1 },
        price: { kind: 'legacy', text: row.want ?? '' },
        perUnit: /each/i.test(row.want ?? ''),
        note: row.notes ?? '',
        status: row.status,
        remoteId: row.remoteId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        legacy: { offer: row.offer ?? '', want: row.want ?? '' },
      })),
    };
  }
  return raw;
};

export const load = () => {
  const db = migrate(readJson(listingsPath, { schema: SCHEMA, listings: [] }));
  db.schema ??= SCHEMA;
  db.listings ??= [];
  return db;
};

export const save = (db) => writeJson(listingsPath, { ...db, schema: SCHEMA });

export const find = (db, id) => {
  const matches = db.listings.filter((row) => row.id === id || row.id.startsWith(id));
  if (matches.length === 0) throw new StoreError(`No listing matching id ${id}`);
  if (matches.length > 1) throw new StoreError(`id ${id} is ambiguous (${matches.length} matches)`);
  return matches[0];
};

export const openFingerprints = (db) =>
  new Map(
    db.listings
      .filter((row) => ['draft', 'approved', 'published'].includes(row.status) && row.price.kind !== 'legacy')
      .map((row) => [fingerprint(row), row]),
  );

/** Adds drafts, refusing any whose trade identity already exists (live or queued). */
export const addDrafts = (specs, { allowDuplicate = false } = {}) => {
  const db = load();
  const seen = openFingerprints(db);
  const added = [];
  const skipped = [];
  for (const spec of specs) {
    validatePrice(spec.price);
    const print = fingerprint(spec);
    const clash = seen.get(print);
    if (clash && !allowDuplicate) {
      skipped.push({ spec, reason: `duplicate of ${clash.id.slice(0, 8)} (${clash.status})` });
      continue;
    }
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      side: spec.side,
      item: spec.item,
      price: spec.price,
      perUnit: spec.perUnit,
      note: spec.note ?? '',
      status: 'draft',
      remoteId: null,
      createdAt: now,
      updatedAt: now,
    };
    db.listings.push(row);
    seen.set(print, row);
    added.push(row);
  }
  if (added.length) {
    save(db);
    for (const row of added) audit('add', { id: row.id, status: row.status, fingerprint: fingerprint(row) });
  }
  return { added, skipped };
};

export const transition = (ids, action, { remoteId } = {}) => {
  const rule = TRANSITIONS[action];
  if (!rule) throw new StoreError(`Unknown action ${action}`);
  const db = load();
  const rows = ids.map((id) => find(db, id));
  for (const row of rows) {
    if (!rule.from.includes(row.status)) throw new StoreError(`Cannot ${action} ${row.id.slice(0, 8)} with status ${row.status}`);
  }
  if (action === 'submitted') {
    if (rows.length !== 1) throw new StoreError('submitted takes exactly one id');
    if (!remoteId?.trim()) throw new StoreError('submitted requires --remote-id (a verified site identifier)');
    rows[0].remoteId = remoteId.trim();
  }
  for (const row of rows) {
    row.status = rule.to;
    row.updatedAt = new Date().toISOString();
    audit(action, { id: row.id, status: row.status, remoteId: row.remoteId ?? null });
  }
  save(db);
  return rows;
};

export const byStatus = (db, status) => (status ? db.listings.filter((row) => row.status === status) : db.listings);

export const summarize = (row) => ({
  id: row.id.slice(0, 8),
  side: row.side,
  item: row.item.name,
  qty: row.item.quantity,
  price: row.price.kind === 'seeds' ? `${formTotals(row).amount} seeds`
    : row.price.kind === 'items' ? formTotals(row).items.map((i) => `${i.quantity}x ${i.name}`).join(' + ')
    : row.price.kind === 'legacy' ? `(v1) ${row.price.text}`
    : 'offers',
  status: row.status,
  remoteId: row.remoteId,
});
