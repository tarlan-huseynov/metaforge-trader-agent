#!/usr/bin/env node
import { load, save, find, addDrafts, transition, byStatus, summarize, applyReprice, StoreError } from './lib/store.js';
import { parseTrade, makeSpec, describe, formTotals, fingerprint, SpecError } from './lib/spec.js';
import { resolve, cacheItem, filterItems, buildIndex, loadItems } from './lib/items.js';
import { createJob, editJob, inventoryJob, jobPayload, installPayload, instructions, pollPayload } from './lib/driver.js';
import { audit } from './lib/audit.js';

// npm passes the `--` separator straight through; drop it so positional trade
// phrases survive `npm run add -- "anvil bp for 2 kinetics"`.
const argv = process.argv.slice(2).filter((value) => value !== '--');
const command = argv[0] ?? 'list';
const args = argv.slice(1);

const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);
const positional = () => args.filter((value, index) => !value.startsWith('--') && !args[index - 1]?.startsWith('--'));
const die = (message) => { console.error(message); process.exit(1); };
const out = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

const ids = () => {
  const list = [flag('id'), ...(flag('ids')?.split(',') ?? []), ...(has('status') ? [] : [])].filter(Boolean);
  if (flag('status')) {
    const db = load();
    list.push(...byStatus(db, flag('status')).map((row) => row.id));
  }
  if (!list.length) die('Need --id <uuid> | --ids a,b,c | --status <state>');
  return [...new Set(list)];
};

const rowsFor = (db) => {
  if (flag('status')) return byStatus(db, flag('status'));
  const selected = [flag('id'), ...(flag('ids')?.split(',') ?? [])].filter(Boolean);
  if (selected.length) return selected.map((id) => find(db, id));
  return byStatus(db, 'approved');
};

const commands = {
  list() {
    const db = load();
    const rows = byStatus(db, flag('status'));
    if (has('json')) return out(rows.map(summarize));
    console.table(rows.map(summarize));
  },

  show() {
    const db = load();
    out(find(db, flag('id') ?? die('Need --id')));
  },

  /** Natural phrase in, structured spec out. Nothing is written. */
  plan() {
    const index = buildIndex();
    const phrases = positional().length ? positional() : [flag('trade') ?? die('Need a trade phrase or --trade')];
    const specs = phrases.map((phrase) => parseTrade(phrase, { index, side: flag('side') }));
    for (const spec of specs) out(describe(spec));
    if (has('json')) out(specs);
  },

  /** Add drafts from phrases ("snap hook bp for 3 kinetics") or explicit flags. */
  add() {
    const index = buildIndex();
    const note = flag('note') ?? '';
    const phrases = positional();
    let specs;
    if (phrases.length) {
      specs = phrases.map((phrase) => ({ ...parseTrade(phrase, { index, side: flag('side') }), note }));
    } else {
      const item = resolve(flag('item') ?? die('Need --item or a trade phrase'), index);
      if (!item.exact) die(`Item "${flag('item')}" is not an unambiguous cached name. Candidates: ${item.candidates.map((c) => c.name).join(', ') || 'none'}`);
      const want = flag('want') ?? die('Need --want (e.g. "2 Kinetic Converter" or "300 seeds")');
      specs = [{ ...parseTrade(`${flag('quantity') ?? 1} ${item.exact} for ${want}`, { index, side: flag('side') }), note }];
    }
    const { added, skipped } = addDrafts(specs, { allowDuplicate: has('allow-duplicate') });
    for (const row of added) out(`draft ${row.id.slice(0, 8)}  ${describe(row)}${row.note ? `  // ${row.note}` : ''}`);
    for (const skip of skipped) out(`skipped  ${describe(skip.spec)}  -- ${skip.reason}`);
    if (!added.length) process.exitCode = skipped.length ? 0 : 1;
  },

  /** Bulk-draft one price across every cached item matching a filter. */
  'add:bulk'() {
    const index = buildIndex();
    const want = flag('want') ?? die('Need --want');
    const items = filterItems({ category: flag('category'), nameMatch: flag('match') }, index);
    if (!items.length) die('No cached items matched --category/--match');
    const specs = items.map((item) =>
      makeSpec({ ...parseTrade(`1 ${item.name} for ${want}`, { index, side: flag('side') }), note: flag('note') ?? '' }),
    );
    if (has('dry-run')) return specs.forEach((spec) => out(describe(spec)));
    const { added, skipped } = addDrafts(specs);
    out(`${added.length} drafts added, ${skipped.length} skipped as duplicates`);
    for (const row of added) out(`  ${row.id.slice(0, 8)}  ${describe(row)}`);
    for (const skip of skipped) out(`  skip  ${describe(skip.spec)} -- ${skip.reason}`);
  },

  approve() { transition(ids(), 'approve').forEach((row) => out(`approved ${row.id.slice(0, 8)}  ${describe(row)}`)); },
  fail() { transition(ids(), 'fail').forEach((row) => out(`needs_review ${row.id.slice(0, 8)}`)); },
  reset() { transition(ids(), 'reset').forEach((row) => out(`draft ${row.id.slice(0, 8)}`)); },
  submitted() {
    const [row] = transition([flag('id') ?? die('Need --id')], 'submitted', { remoteId: flag('remote-id') });
    out(`published ${row.id.slice(0, 8)}  remoteId=${row.remoteId}`);
  },
  /** Only after the live listing is confirmed gone (cancel click verified in My Listings). */
  delist() {
    transition(ids(), 'delist', { remoteId: flag('evidence') }).forEach((row) => out(`draft ${row.id.slice(0, 8)}  (was published, now delisted)`));
  },

  /** Convert v1 free-text prices into structured ones so they can drive the browser. */
  migrate() {
    const index = buildIndex();
    const db = load();
    let changed = 0;
    const failures = [];
    for (const row of db.listings) {
      if (row.price.kind !== 'legacy') continue;
      try {
        const spec = parseTrade(`${row.item.quantity} ${row.item.name} for ${row.price.text}`, { index });
        row.price = spec.price;
        row.perUnit = spec.perUnit;
        row.updatedAt = new Date().toISOString();
        changed += 1;
      } catch (error) {
        failures.push({ id: row.id.slice(0, 8), item: row.item.name, text: row.price.text, error: error.message });
      }
    }
    if (changed) { save(db); audit('migrate', { converted: changed }); }
    out(`converted ${changed} legacy rows`);
    if (failures.length) out({ needsManualFix: failures });
  },

  'items:find'() {
    const hit = resolve(flag('query') ?? positional()[0] ?? die('Need --query'), buildIndex());
    out(hit);
    if (!hit.exact) process.exitCode = 2;
  },
  'items:add'() {
    const name = flag('name') ?? die('Need --name (exactly as MetaForge autocomplete showed it)');
    const result = cacheItem(name, flag('category') ?? '');
    audit('items:add', { name: result.name, added: result.added });
    out(result.added ? `cached ${result.name}` : `already cached ${result.name}`);
  },
  'items:stats'() {
    const data = loadItems();
    const byCategory = {};
    for (const item of data.items) byCategory[item.category || 'unknown'] = (byCategory[item.category || 'unknown'] ?? 0) + 1;
    out({ total: data.items.length, updatedAt: data._meta?.updatedAt, byCategory });
  },

  'payload:install'() { out(installPayload()); },

  /** Emits the one-line payload that fills (and optionally submits) listings. */
  'payload:create'() {
    const db = load();
    const rows = rowsFor(db);
    if (!rows.length) die('No listings selected (use --id/--ids/--status; default is status=approved)');
    const legacy = rows.filter((row) => row.price.kind === 'legacy');
    if (legacy.length) die(`${legacy.length} selected rows still have v1 prices. Run: npm run migrate`);
    const notApproved = rows.filter((row) => row.status !== 'approved');
    if (has('commit') && notApproved.length) {
      die(`Refusing to commit unapproved listings: ${notApproved.map((r) => `${r.id.slice(0, 8)}:${r.status}`).join(', ')}`);
    }
    const job = createJob(rows, { commit: has('commit'), pauseMs: Number(flag('pause') ?? 400) });
    if (!has('quiet')) {
      console.error(instructions(job));
      console.error('');
      for (const row of rows) console.error(`  ${row.id.slice(0, 8)}  ${describe(row)}${row.note ? `  // ${row.note}` : ''}`);
      console.error('');
    }
    out(jobPayload(job));
  },

  /** Reprice live listings. Needs the operator to name them with --ids. */
  'payload:edit'() {
    const db = load();
    const want = flag('want') ?? die('Need --want (the new price, e.g. "2 kinetics" or "400 seeds")');
    const index = buildIndex();
    const selected = (flag('ids') ?? flag('id') ?? die('Need --ids (live edits are never selected by status)')).split(',');
    const rows = selected.map((id) => find(db, id));
    const notLive = rows.filter((row) => row.status !== 'published');
    if (notLive.length) die(`Not live, so nothing to edit: ${notLive.map((r) => `${r.id.slice(0, 8)}:${r.status}`).join(', ')}`);
    const entries = rows.map((row) => {
      const spec = parseTrade(`${row.item.quantity} ${row.item.name} for ${want}`, { index });
      return { row, price: spec.price, perUnit: spec.perUnit, ...(flag('note') === undefined ? {} : { note: flag('note') }) };
    });
    const job = editJob(entries, { commit: has('commit') });
    if (!has('quiet')) {
      console.error(`EDIT ${rows.length} live listing(s)${has('commit') ? ' — COMMIT' : ' — dry run'}`);
      for (const { row, price, perUnit } of entries) {
        console.error(`  ${row.id.slice(0, 8)}  ${row.item.name}: ${describe(row)}  =>  ${describe({ ...row, price, perUnit })}`);
      }
      console.error('');
    }
    out(jobPayload(job));
  },

  /** Write a verified reprice back into the registry. */
  reprice() {
    const index = buildIndex();
    const db = load();
    const row = find(db, flag('id') ?? die('Need --id'));
    const want = flag('want') ?? die('Need --want');
    const spec = parseTrade(`${row.item.quantity} ${row.item.name} for ${want}`, { index });
    out(`repriced ${describe(applyReprice(row.id, spec.price, spec.perUnit))}`);
  },

  'payload:inventory'() { out(jobPayload(inventoryJob())); },
  'payload:poll'() { out(pollPayload()); },

  /** Reconcile a finished job's results back into the registry. */
  'apply-result'() {
    const raw = flag('json') ?? die('Need --json \'<__MF_JOB contents>\'');
    const state = JSON.parse(raw);
    if (state.error) out({ jobError: state.error });
    for (const result of state.results ?? []) {
      if (!result.id) continue;
      if (result.dryRun) { out(`dry-run ok ${result.id.slice(0, 8)}`); continue; }
      if (result.edit) {
        if (result.ok) out(`edit verified ${result.id.slice(0, 8)}  ${result.evidence?.[0] ?? ''}`);
        else out(`edit FAILED ${result.id.slice(0, 8)}  ${JSON.stringify(result.problems ?? 'no confirmation in page')}`);
        continue;
      }
      if (result.ok && result.evidence?.length) {
        const remote = `verified:${result.evidence[0].slice(0, 60)}`;
        transition([result.id], 'submitted', { remoteId: remote });
        out(`published ${result.id.slice(0, 8)}  ${remote}`);
      } else {
        transition([result.id], 'fail');
        out(`needs_review ${result.id.slice(0, 8)}  ${JSON.stringify(result.problems ?? 'no confirmation in page')}`);
      }
    }
  },

  /** Local-only removal of a queued row. Never touches a live listing. */
  discard() {
    const db = load();
    const row = find(db, flag('id') ?? die('Need --id'));
    if (!['draft', 'needs_review'].includes(row.status)) die(`Only draft/needs_review rows can be discarded locally (this one is ${row.status})`);
    db.listings = db.listings.filter((entry) => entry.id !== row.id);
    save(db);
    audit('discard', { id: row.id, status: row.status });
    out(`discarded ${row.id.slice(0, 8)}  ${describe(row)}`);
  },

  fingerprints() { out(load().listings.filter((r) => r.price.kind !== 'legacy').map((r) => ({ id: r.id.slice(0, 8), status: r.status, fingerprint: fingerprint(r) }))); },

  totals() { out(load().listings.filter((r) => r.price.kind !== 'legacy').map((r) => ({ id: r.id.slice(0, 8), item: r.item, form: formTotals(r) }))); },

  help() {
    out(`metaforge trading agent

  queue      list [--status s] [--json] | show --id ID | plan "<phrase>" | fingerprints | totals
  drafts     add "<phrase>..." [--note n] | add --item I --quantity N --want W
             add:bulk --want W [--category c] [--match m] [--dry-run]
  state      approve|fail|reset (--id|--ids|--status) | submitted --id ID --remote-id R | migrate
             delist (--id|--ids|--status) --evidence "<what confirmed it's gone>"  (published -> draft)
  items      items:find --query q | items:add --name "Exact Name" [--category c] | items:stats
  browser    payload:install | payload:create [--id|--ids|--status] [--commit] | payload:inventory
             payload:poll | apply-result --json '<job json>'
  edits      payload:edit --ids a,b --want W [--commit] | reprice --id ID --want W
  local      discard --id ID   (draft/needs_review only; never touches the site)

Trade phrases are parsed deterministically: "<qty> <item> for <qty> <item|seeds> [each]".
Prices default to per-unit; formTotals multiplies by listing quantity exactly once.`);
  },
};

try {
  (commands[command] ?? (() => die(`Unknown command ${command}. Try: npm run help`)))();
} catch (error) {
  if (error instanceof SpecError || error instanceof StoreError) die(`${error.constructor.name}: ${error.message}`);
  throw error;
}
