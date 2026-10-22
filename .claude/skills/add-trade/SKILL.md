---
name: add-trade
description: List a new single item for sale or want on MetaForge from a plain trade phrase like "snap hook bp for 3 kinetics" or "selling anvil blueprint for 400 seeds". Use whenever the operator wants to post one new trade/listing, not a bulk refresh of existing ones (that's recreate-listings) and not a price change on something already live (that's an edit — see dom-contract.md's "Paths not yet exercised").
---

# Add a trade

This turns one trade phrase into a live, verified listing: draft -> approve -> dry
run -> commit -> apply-result. It's the single-listing version of the flow in
`docs/playbook.md` — read that file's "1. Turn the request into drafts" through
"4. Commit, then reconcile" sections for the exact commands; this file is about
running them end-to-end for one phrase without stopping at each step unnecessarily.

## Flow

1. `npm run add -- "<phrase>"` — if it skips as a duplicate, say so and stop; don't
   force it with `--allow-duplicate` unless the operator explicitly says this is a
   deliberately repeated trade.
2. If the item in the phrase isn't an unambiguous cached name, `add` will refuse and
   list candidates (or none). Don't guess a name from memory — search MetaForge's own
   autocomplete live, confirm the exact text with the operator only if it's genuinely
   ambiguous, then `npm run items:add -- --name "<exact text>" --category <hint>`.
   Retry the add once the name is cached.
3. Show the draft, get approval: `npm run approve -- --id <id>`. One approval per
   trade is enough here — this isn't a batch, so there's no need to invent a batch
   question.
4. `npm run payload:install` (once per page load) then `npm run payload:create`
   (dry run) via `browser_execute_script`, poll `window.__MF_JOB` until `done:true`.
   If `ok:false`, report the `problems` — don't retry blind, don't commit anyway.
5. On a clean dry run, re-run `payload:create -- --commit`, execute it, poll again,
   then `npm run apply-result -- --json '<job JSON>'`.
6. Report: drafted, approved, dry-run result, published-with-evidence or
   needs_review, and the final listing's exact terms.

## What doesn't bend

- Never type a quantity by clicking +/- in the browser — the runtime handles this
  and asserts the read-back (CLAUDE.md #6).
- A CAPTCHA, MFA, or anti-bot challenge stops the run; hand it back (CLAUDE.md #8).
- An ambiguous or timed-out submit: inspect My Listings first, don't auto-retry
  (CLAUDE.md #9).
