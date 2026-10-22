# Run loop

Everything below assumes the operator is logged in to MetaForge in their own Firefox
and the tab is on **My Listings**. Confirm the tab first: `browser_find_tabs` with
`url_pattern: metaforge`, then pass that `tab_id` on every call.

## 1. Turn the request into drafts (no browser)
```bash
npm run plan -- "snap hook bp for 3 kinetics"        # parse only, writes nothing
npm run add  -- "anvil bp for 2 kinetics" --note "1 bp for 2 kinetics"
npm run add:bulk -- --category blueprint --want "2 kinetics" --note "1 bp for 2 kinetics" --dry-run
```
`add` refuses an item that is not an unambiguous cached name, and skips a trade whose
fingerprint already exists as a draft, approved or published row. Nothing is guessed.

## 2. Get approval
Show the operator `npm run list`, then:
```bash
npm run approve -- --status draft          # or --id <8 chars> / --ids a,b,c
```
Approval is per listing and never inferred from an earlier request.

## 3. Dry run in the browser (3 calls)
```bash
npm run payload:install        # paste output into browser_execute_script  (once per page load)
npm run payload:create         # paste output into browser_execute_script  (defaults to --status approved)
# then: browser_execute_script  JSON.stringify(window.__MF_JOB)   until done:true
```
A dry run fills every field, compares the live form against the spec, then cancels.
`ok: true, dryRun: true` means the form was exactly right. `problems` names each mismatch.

## 4. Commit, then reconcile
```bash
npm run payload:create -- --commit      # refuses anything not in status=approved
# paste, poll window.__MF_JOB as above, then:
npm run apply-result -- --json '<the job JSON>'
```
`apply-result` publishes only rows whose result carried page evidence of the new
listing, and puts the rest in `needs_review`. A listing is never marked published
on a hopeful assumption.

## Rules that do not bend
- Never type an item name from memory. Unknown name -> search it live once, then
  `npm run items:add -- --name "<exact autocomplete text>" --category <hint>`.
  Do this as a normal part of handling any trade that touches a new item.
- Never click a quantity `+`/`-` button. The runtime writes quantities once and
  asserts the read-back; clicking is what produced `12` where `2` was meant.
- Never submit without a passing dry run for anything new in shape (new mode, new
  multi-item barter, first run after a site change).
- Editing, cancelling or relisting a live listing needs fresh approval naming it.
- A CAPTCHA, MFA or anti-bot challenge stops the run; the operator clears it by hand.
- Do not read cookies, tokens, storage or private endpoints; drive the visible UI.
- On an ambiguous or timed-out submit: do not retry. Read My Listings first, then report.

## Recreate listings ("refresh", "recreate as they are / with adjustments")
Marketplace sort favors recent listings, so the operator periodically refreshes their
whole active set to resurface it. When asked to "recreate" or "refresh" listings:

1. Open My Listings and read the current Active set — item, want-side, note, age. No
   question needed to start this; it's read-only.
2. "Recreate" means cancel+recreate, full stop — do that, not Bump. Bump is a different,
   smaller action (resurface without changing anything) and is only ever used when the
   operator asks for a bump/refresh in those terms, or asks generically what to do about
   stale listings. If the operator says "recreate" (as-is or with adjustments), go
   straight to step 5's cancel+recreate sequence for every listing in scope — do not
   substitute Bump as a "safer" default; that is overriding their instruction, not
   following it.
3. Present the full current list once, in one message, with a numbered table, then move
   straight to step 4. Do not ask the operator to pick a strategy — "recreate" already is
   the strategy.
4. Still get approval before any cancel or live submit (CLAUDE.md rule #2/#5) — but ask
   it once, as a single batch: "recreate these N listings identically, approve?" or
   "recreate with: <adjustments>, approve?" Do not ask per-listing unless the operator's
   request itself was per-listing, and do not ask clarifying questions the operator has
   already answered by saying "as they are" (= same item/want/qty/note) or by giving the
   adjustment inline.
5. Cancel+recreate, **delist-then-create, never create-then-delist**. Every step is
   batched across the whole set; none of it is per listing:

   | # | Command | Browser calls |
   |---|---|---|
   | 1 | `npm run payload:listings` | 1 (sync, no poll) |
   | 2 | `npm run add -- "<spec>" --allow-duplicate` xN, then `npm run approve -- --ids a,b,c` | 0 |
   | 3 | `npm run payload:delist -- --ids a,b,c` | 1 + polls |
   | 4 | reload My Listings, reinstall, `npm run payload:listings` to confirm | 3 |
   | 5 | `npm run delist -- --ids a,b,c --evidence "<what the reload showed>"` | 0 |
   | 6 | `npm run payload:create -- --ids ...` (dry run) | 1 + polls |
   | 7 | `npm run payload:create -- --ids ... --commit` | 1 + polls |
   | 8 | `npm run apply-result -- --json '<payload:result output>'` | 0 |

   The replacement drafts must exist and be approved (step 2) before anything live is
   touched in step 3. **Do not** create a replacement while its original is still live
   -- see `docs/dom-contract.md`'s "Creating a duplicate while the original is live
   hangs". Step 4 is not optional: an in-page removal pass is provisional, and step 5
   is what makes the tracker agree with the site.
6. Report at the end which were bumped vs. recreated, with evidence for each recreate.
7. Skip any listing with an open negotiation or lock-in in progress (check Messages/chat
   count **freshly read at the moment of acting**, not just the chat count read at the
   start — it can change mid-run). If a chat's listing can't be disambiguated from the
   note text alone (e.g. two listings share an identical note), skip every listing that
   note could belong to rather than guessing which one. Recreate the rest without
   waiting on it; flag the skipped one(s) and why. Don't cancel a listing someone is
   actively mid-deal on without the operator handling that chat first.

### Reading results, and polling

Read a finished job with `npm run payload:result`, never `JSON.stringify(window.__MF_JOB)`.
The raw job carries a 500-character `bodyText` per result that nothing downstream reads;
the projection keeps only what `apply-result` consumes and is what you paste straight
back into it.

Don't fix a single long `sleep` before the first poll. Listings take ~4s each, so check
at roughly `4s x N`, then every 2s until `done:true`. A standalone long sleep is both
slower on average and refused by the harness.

### Don't reinstall the runtime you already have

Every job payload answers `{"needsInstall": true}` when the runtime is gone. Send the
job first and reinstall only on that answer -- `npm run payload:install` is ~530 lines,
and re-sending it "just in case" is the single most expensive thing you can do. The
runtime survives until the page reloads, so keep reloads deliberate (step 4 above is
the one reload a recreate run needs).
## Inventory
```bash
npm run payload:inventory      # paste; poll; one call returns the whole stash
```
Treat the result as valid for minutes only. Cache the item **names** it reveals
(`items:add`); never cache quantities.

## Paths not yet exercised against the live site
Treat a first run through any of these as discovery: dry-run it, expect the DOM
contract to need a line, then it is settled like the rest.
- `Buy an item` (the whole buy side)
- `Offers` as a payment mode
- more than one wanted item in a single listing
- editing in the other direction (items -> Seeds)
- bumping a listing (not implemented at all)

Cancelling/removing a listing **is** exercised — see `docs/dom-contract.md`'s
"Cancelling (removing) a live listing".
