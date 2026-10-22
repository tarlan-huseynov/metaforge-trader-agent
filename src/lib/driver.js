import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formTotals } from './spec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeFile = path.resolve(here, '..', 'browser', 'runtime.js');

export const runtimeSource = () => fs.readFileSync(runtimeFile, 'utf8');

/**
 * The runtime is injected once per page load; after that every job is a one-line
 * payload. That is the whole token strategy: heavy logic lives in the page, not
 * in the conversation.
 */
export const installPayload = () => runtimeSource();

const asJobSpec = (row) => {
  const totals = formTotals(row);
  return {
    id: row.id,
    side: row.side,
    item: { name: row.item.name, quantity: row.item.quantity },
    form: totals,
    note: row.note ?? '',
  };
};

export const jobPayload = (job) =>
  `(window.MF ? window.MF.run(${JSON.stringify(job)}) : JSON.stringify({ needsInstall: true }))`;

export const createJob = (rows, { commit = false, pauseMs = 400, stopOnError = true } = {}) => ({
  kind: 'create',
  commit,
  pauseMs,
  stopOnError,
  specs: rows.map(asJobSpec),
});

/**
 * Repricing live listings. `price` is the new price; the row's own item and
 * quantity are kept, and the note is left untouched unless one is given.
 */
export const editJob = (entries, { commit = false, pauseMs = 500 } = {}) => ({
  kind: 'edit',
  commit,
  pauseMs,
  stopOnError: true,
  specs: entries.map(({ row, price, perUnit = row.perUnit, note }) => {
    const next = { ...row, price, perUnit };
    return {
      id: row.id,
      side: row.side,
      item: { name: row.item.name, quantity: row.item.quantity },
      form: formTotals(next),
      ...(note === undefined ? {} : { note }),
    };
  }),
});

export const inventoryJob = () => ({ kind: 'inventory' });

/** One call that returns every live row projected to {item, price, chats, note, listedAt}. */
export const listingsJob = () => ({ kind: 'listings' });

/**
 * Reading listings needs no job at all: it is synchronous, so the answer comes
 * back from the same call that asks, with nothing parked on window.__MF_JOB.
 * One browser call instead of a start plus polls.
 */
export const listingsPayload = () =>
  'JSON.stringify(window.MF ? window.MF.readListings() : { needsInstall: true })';

/**
 * Cancelling live listings in one job instead of three browser calls each.
 * The results are provisional by design: a page that has not reconciled with the
 * server can still show a removed row, so the caller re-reads after a reload
 * before recording anything in the tracker.
 */
export const delistJob = (rows, { pauseMs = 400, stopOnError = true } = {}) => ({
  kind: 'delist',
  pauseMs,
  stopOnError,
  specs: rows.map((row) => ({ id: row.id, name: row.item.name })),
});

/**
 * Reads the finished job back as a projection. The raw __MF_JOB carries a
 * 500-character `bodyText` per result that nothing downstream reads, so pulling
 * it through the conversation costs thousands of tokens for no decision value.
 * `apply-result` consumes exactly the keys kept here.
 */
export const resultPayload = () => `JSON.stringify((() => {
  const job = window.__MF_JOB;
  if (!job) return { missing: true };
  const pick = (r) => ({
    id: r.id, ok: r.ok, dryRun: r.dryRun, edit: r.edit, delist: r.delist,
    problems: r.problems, evidence: r.evidence ? r.evidence.slice(0, 1) : undefined,
    side: r.side, quantity: r.quantity, item: r.item, price: r.price,
    chats: r.chats, note: r.note, listedAt: r.listedAt,
  });
  return { done: job.done, job: job.job, error: job.error, results: job.results.map(pick) };
})())`.replace(/\s+/g, ' ');

/** Condition + action for one browser_wait_and_act call that collects the result. */
export const pollPayload = () => ({
  condition: 'window.__MF_JOB && window.__MF_JOB.done',
  action_script: 'JSON.stringify(window.__MF_JOB)',
});

/**
 * Three browser_execute_script calls for a whole batch. The ClaudeCodeBrowser
 * bridge in use does not implement browser_eval_chain or browser_wait_and_act,
 * so the result is collected by polling window.__MF_JOB with a plain script.
 */
export const instructions = (job) => [
  '1. browser_execute_script  -> output of `npm run payload:install`, but ONLY if a job answered needsInstall:true (the runtime survives until the page reloads)',
  `2. browser_execute_script  -> the job payload below (${job.kind}${job.commit ? ', COMMIT' : ', dry run'})`,
  `3. browser_execute_script  -> output of \`npm run payload:result\`   (first check after ~${4 * (job.specs?.length ?? 1)}s, then every 2s while done:false)`,
  '4. npm run apply-result -- --json \'<that JSON>\'',
].join('\n');
