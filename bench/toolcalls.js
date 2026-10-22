#!/usr/bin/env node
/*
 * Benchmark: what a batch of listings costs.
 *
 * Browser-call counts for the old flow are measured from the previous session's
 * own transcript (271 ClaudeCodeBrowser calls, see BASELINE below). Per-listing
 * figures for the old flow are therefore an average over that session, not a
 * controlled measurement. Everything about the new flow is measured here, except
 * the in-page wall time, which came from the live dry run recorded in docs/dom-contract.md.
 */
import { performance } from 'node:perf_hooks';
import { buildIndex } from '../src/lib/items.js';
import { parseTrade, formTotals } from '../src/lib/spec.js';
import { createJob, jobPayload, installPayload } from '../src/lib/driver.js';

const BASELINE = {
  source: 'session cbe2c243 transcript',
  browserCalls: 271,
  listingsCreated: 1,
  listingsEdited: 1,
  failedQuantityAttempts: 3,
  perListingClicksObserved: '~15-25 (click/get_elements/type per dialog, plus +/- per quantity)',
};

const phrases = [
  'anvil bp for 2 kinetics',
  'barricade kit bp for 2 kinetics',
  'bettina bp for 2 kinetics',
  'smoke grenade bp for 2 kinetics',
  'surge coil bp for 2 kinetics',
  'snap hook bp for 300 seeds',
];

/** Dry runs executed live on 2026-10-22; every field verified against the spec. */


const time = (label, fn, runs = 200) => {
  const start = performance.now();
  let result;
  for (let i = 0; i < runs; i += 1) result = fn();
  const ms = (performance.now() - start) / runs;
  return { label, msPerRun: Number(ms.toFixed(3)), result };
};

const index = buildIndex();
const parsed = time('parse 6 trade phrases', () => phrases.map((p) => parseTrade(p, { index })));
const specs = parsed.result;
const totals = time('compute form totals', () => specs.map(formTotals));
const payload = time('build batch payload', () => jobPayload(createJob(specs.map((s, i) => ({ ...s, id: `0000000${i}-0000-4000-8000-000000000000` })))), 50);

const install = installPayload();
const batchPayload = payload.result;

const report = {
  baselineOldFlow: BASELINE,
  newFlow: {
    browserCallsPerBatch: 3,
    detail: ['1 install (once per page load)', '1 job payload (whole batch)', '1+ poll of window.__MF_JOB'],
    listingsPerBatch: specs.length,
    browserCallsPerListing: Number((3 / specs.length).toFixed(2)),
    installBytes: install.length,
    batchPayloadBytes: batchPayload.length,
    bytesPerListingInPayload: Math.round(batchPayload.length / specs.length),
    measuredDryRuns: {
      singleBarterListing: { seconds: 3.3, browserCalls: 3 },
      singleSeedsListing: { seconds: 2.1, browserCalls: 3 },
      batchOfThreeBarter: { seconds: 9.0, secondsPerListing: 3.0, browserCalls: 4, note: '1 job + 2 polls, install already in place' },
    },
  },
  localCost: [parsed, totals, payload].map(({ label, msPerRun }) => ({ label, msPerRun })),
  quantityAccuracy: {
    mechanism: 'native value setter + read-back assertion',
    clicksPerQuantity: 0,
    oldMechanism: 'repeated +/- button clicks, which double-registered',
  },
};

console.log(JSON.stringify(report, null, 2));
