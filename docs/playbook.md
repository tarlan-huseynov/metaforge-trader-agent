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
- cancelling, deleting or bumping a listing (not implemented at all)
