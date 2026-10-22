---
name: sync-inventory
description: Read the operator's live MetaForge inventory/stash and cache any item names it reveals into data/items.json, so future trade phrases can resolve shorthand like "bp" or "kinetics" without guessing. Use when the operator asks what's in their inventory/stash, wants to list something from their stash that isn't recognized yet, or mentions an "unknown item" error from add-trade.
---

# Sync inventory

Reads the operator's live stash through the browser (never storage, never an API —
CLAUDE.md #1) and caches the item **names** it reveals. Never caches quantities: the
stash changes constantly and a cached count would just be wrong within minutes.

## Flow

1. `npm run payload:install` (skip if already installed this page load).
2. `npm run payload:inventory`, run it via `browser_execute_script`, poll
   `window.__MF_JOB` until `done:true`. This returns every stash slot's name and
   stack size in one call.
3. For each item name not already in `data/items.json`: this is a name seen directly
   in the operator's own inventory UI, not typed from memory, so it satisfies
   CLAUDE.md #7's bar for caching — run
   `npm run items:add -- --name "<exact name>" --category <best-guess hint>`.
4. Report what's new: item names added, and the current stack sizes (as a point-in-time
   read, explicitly labeled as "valid for minutes only" per `docs/playbook.md`) —
   don't let the operator or a later step treat the quantities as durable.

## When this gets triggered indirectly

If `add-trade` hits an item it can't resolve, that's often because the item hasn't
been seen in inventory or autocomplete yet. Running this skill first can shortcut
the "search it live, then items:add" step for anything already sitting in the stash.
For an item that's genuinely new and not in inventory either, fall back to
`add-trade`'s own search-the-autocomplete path instead — this skill only covers
what's visible in the stash, not the full item database.
