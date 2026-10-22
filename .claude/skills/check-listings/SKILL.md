---
name: check-listings
description: Read-only health check of the operator's live MetaForge listings against the local tracker (data/listings.json) — surfaces drift like a price that changed outside this tool, a listing that sold/expired but is still tracked as published, or an active chat/negotiation. Use when the operator asks "what's live right now", "check my listings", "are we in sync", or before any recreate/edit so mismatches get caught up front instead of mid-flight.
---

# Check listings

Read-only. Never cancels, edits, or creates anything — this is purely an inspection
pass, so there's nothing here that needs approval before running.

## Why this exists

The local tracker (`data/listings.json`, read via `node src/cli.js list --json`) can
drift from what's actually live: a buyer completes a trade, a listing expires, or the
operator edits something by hand on the site. Treating the tracker as ground truth
when it's stale is how a recreate ends up relisting a wrong price. This skill exists
to catch that drift before it causes a mistake, not just to print a status table.

## Flow

1. Open (or find the existing tab for) `https://metaforge.app/arc-raiders/market/my-listings`.
2. Read every active row: item, price/want side, listed time, chat count. The
   displayed item name is CSS-truncated — read `textContent` via
   `browser_execute_script`, not the rendered label, to get the full name.
3. Pull the local tracker's published rows: `node src/cli.js list --status published --json`.
4. Diff the two by item name. Report:
   - **Matches** — live and tracked terms agree.
   - **Price/terms drift** — same item, different price or quantity live vs. tracked.
     Call out which one looks newer/more trustworthy (live is almost always the
     source of truth, since the site is authoritative) but don't silently overwrite
     the tracker — say what you found.
   - **Tracked but not live** — the tracker says published, the site shows nothing.
     Likely sold, expired, or removed outside this tool. Flag it; don't assume it's
     safe to just re-add without the operator's say.
   - **Live but not tracked** — a listing exists on the site that `data/listings.json`
     doesn't know about (e.g. made from another device, or before this tool existed).
     Flag it; offer to backfill it into the tracker with its real price if asked.
   - **Open negotiations** — any row with 1+ chats or a lock-in in progress. These
     should never get swept into an automatic recreate/cancel elsewhere.
5. Keep the report to a table — item, live terms, tracked terms, status — not prose
   per listing.

This is the inspection step `recreate-listings` runs before touching anything; it's
also useful standalone whenever the operator just wants to know where things stand.
