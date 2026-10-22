---
name: recreate-listings
description: Refresh the operator's live MetaForge listings so they resurface at the top of the marketplace. Use this whenever the operator says "recreate", "refresh", or "redo" their listings, asks to cancel and relist everything, or mentions listings going stale / losing visibility — even if they don't name every listing explicitly. Covers both "recreate as they are" and "recreate with adjustments" (price/quantity/item changes).
---

# Recreate listings

MetaForge sorts the marketplace by recency, so listings that sit for a while lose
visibility even when the price and item are still correct. The operator's fix is to
refresh their whole active set periodically: read what is live, then cancel and
recreate each one, same terms or adjusted. This is routine, expected behavior — not
something to treat with suspicion or re-litigate each time it's asked for.

Read `docs/playbook.md`'s "Recreate listings" section for the exact command sequence
(delist -> add -> approve -> dry run -> commit -> apply-result). This file is about
the conversation shape around that sequence — what to ask, what not to ask, and the
safety rails that don't bend even though the rest of this is routine.

## The one question to ask

Once you've read My Listings, ask exactly one batch question:

> "recreate these N listings as they are, or with adjustments?"

Don't ask the operator to pick a strategy (bump vs. recreate) — "recreate" already
told you the strategy. Don't ask per listing unless they asked per listing. If they
answer inline in the same message ("recreate the seeds ones lower by 100"), that
already answers the question — don't ask it again.

## Before touching anything

1. Read My Listings (read-only, no question needed to start this).
2. Cross-check against the local tracker (`node src/cli.js list --status published
   --json`). Live and local drift — a listing can sell, expire, or get hand-edited
   outside this tool. Don't assume the tracker is current; use whatever is actually
   live as the source of truth for what to recreate, and flag any mismatch you find
   rather than silently picking one side.
3. Skip, automatically, any listing with an open chat or a lock-in in progress
   (check "N chats", not just the listing's age). This is standing behavior per the
   operator, not something to flag and wait on — recreate the rest, note what you
   skipped and why in the final report.
4. If a listing the tracker says is published is no longer live at all (sold,
   expired, removed by hand), don't try to recreate it from stale data — mention it
   and move on.

## What doesn't bend

Even though "recreate" is routine, these are still real actions on a live account
(CLAUDE.md non-negotiables #2, #5, #9):
- Cancel+recreate needs the batch approval above before any cancel or live submit.
- Cancelling a listing needs the local tracker to actually reflect it first. If
  `delist` doesn't exist yet in `src/lib/store.js` (a `published -> draft` transition
  gated on evidence the live listing is confirmed gone), that's a real gap to fix in
  the store/CLI before proceeding — not something to route around by editing the
  JSON file by hand.
- An ambiguous or failed cancel/recreate on one listing: stop on that one, report it,
  don't retry blind. Keep going on the rest of the batch.
