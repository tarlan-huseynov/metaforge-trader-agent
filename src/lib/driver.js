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

export const inventoryJob = () => ({ kind: 'inventory' });

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
  '1. browser_execute_script  -> output of `npm run payload:install` (once per page load; a job answering needsInstall:true means it is gone)',
  `2. browser_execute_script  -> the job payload below (${job.kind}${job.commit ? ', COMMIT' : ', dry run'})`,
  '3. browser_execute_script  -> JSON.stringify(window.__MF_JOB)   (repeat only while done:false)',
  '4. npm run apply-result -- --json \'<that JSON>\'',
].join('\n');
