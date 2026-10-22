# MetaForge DOM contract

Verified live on 2026-10-22 against `https://metaforge.app/arc-raiders/market/my-listings`.
Re-verify with `npm run payload:install` + a dry run whenever a step starts timing out.

## Framework notes
- Svelte + bits-ui. Dialog ids (`#bits-cNN`) change on every open — never select by id.
- The dialog is `position: fixed`, so `offsetParent` is **null** while it is visible.
  Visibility must be tested with `getClientRects().length > 0`.
- Quantity fields are plain `<input type="text">`, but the native value setter only
  changes what is **displayed**. Verified live on 2026-10-22: a wanted-item quantity
  written to `2` that way, with the input reading `2` at save time, **saved as `1`**.
  The `Increase/Decrease <Item> quantity` buttons are the only thing that moves the
  component's real state, so wanted quantities are stepped **one click at a time with
  a read-back after every click** (`stepQuantity`) — never chained blind, which is
  what produced `12` instead of `2`.
- The seed price (`#listing-price`) does persist from the native setter. Verified:
  seven listings saved at exactly `400`.
- `element.click()` works on every button in the dialog. The dialog closes
  asynchronously, so a close must be confirmed on a later tick, not the same one.

## "New listing" is a three-screen wizard
| Screen | Prompt | Buttons |
|---|---|---|
| 1 | What do you want to do? | `Sell an item …`, `Buy an item …` |
| 2 | What do you want in return? | `Seeds A price per item`, `Items Swap item for item`, `Offers Let others make an offer` |
| 3 | the form | `Back`, `Cancel`, `Create listing` |

Screen 2's buttons carry a description, so match `/^Seeds\b/`, not `/^Seeds$/`.
The edit dialog (My Listings -> Edit) skips straight to the form and submits with
`Save changes`; its mode toggle is a plain `Seeds` / `Items` / `Offers` row.

## Form selectors (screen 3)
| What | Selector |
|---|---|
| dialog | `[role="dialog"]` (take the last visible one) |
| item search | `input[placeholder*="Search for an item" i]` |
| autocomplete results | `[role="option"]` — match the option's exact text |
| listing quantity | `#listing-quantity` |
| seed price (Seeds mode) | `#listing-price` |
| add a wanted item | `input[placeholder*="another item" i]` |
| wanted item quantity | `input[aria-label="<Item Name> quantity"]` |
| remove a wanted item | `button[aria-label="Remove <Item Name>"]` |
| note | `#listing-note`, **only after** clicking the `+ Add a note` button |
| step a wanted quantity | `button[aria-label="Increase\|Decrease <Item Name> quantity"]` |
| step the listing quantity | `button[aria-label="Increase\|Decrease quantity"]` (Decrease is disabled at 1) |
| submit | `Create listing` (create) / `Save changes` (edit) |

Fields appear progressively: screen 3 starts with only the item search; quantity and
the wanted-items list render after an item is chosen.

## Cancelling (removing) a live listing

Each My Listings row has a `button[aria-label="Remove listing"]`. Clicking it opens a
confirm dialog — `role="dialog"` or `role="alertdialog"`, heading "Remove this listing?",
with two buttons: `Keep it` and `Remove` (destructive, `bg-destructive`). The listing is
only actually gone once `Remove` is clicked and the row disappears from a re-read of My
Listings; the first click (on the row) only opens the confirmation, it does not remove
anything by itself.

Both steps plus the verification live in the runtime as the `delist` job kind
(`npm run payload:delist`), so cancelling N listings costs one job and a poll
rather than three browser calls each.

```js
// 1. open the confirm dialog        2. confirm it        3. wait for the row to go
remove.click();                       confirm.click();     await waitFor(() => !rowFor(name));
```

The confirmation is `role="alertdialog"` on some builds and `role="dialog"` on
others, so it is looked up through `anyDialog()`, which accepts either.

**An in-page pass is provisional.** Observed 2026-10-23: immediately after four
successful removals the page re-rendered all nine original rows, with their
original timestamps, as though nothing had been removed; a hard reload showed the
removals had in fact persisted. The client state and the server can disagree in
*either* direction, so a removal is only recorded in the tracker after a reload
and a fresh `payload:listings` read -- never from the job result alone.

**Creating a duplicate while the original is live hangs.** Verified live on
2026-10-22: calling `createOne` with a spec identical to a still-published listing
(same item, same price) reproducibly timed out at "Timed out waiting for dialog to
close after submit" — twice, on two different items (Anvil Blueprint, Extended Barrel
III Blueprint) — with **no new listing created** either time (row count unchanged
after each attempt). The site evidently blocks or silently no-ops a duplicate submit
in a way this runtime doesn't detect as a submit failure. Do not use
`--allow-duplicate` + remove-the-original-after for a recreate; always remove the
live original first (see above), confirm it's gone, and only then create the
replacement. This applies even though `addDrafts(..., { allowDuplicate: true })` at
the tracker level is still correct and necessary — the duplicate collision is a
tracker-level, not DOM-level, problem, and the DOM-level order must still be
delist-then-create.

## Editing a live listing
My Listings row -> `Edit` -> the form directly, submitting with `Save changes`.
Find the row by walking up from its `Edit` button and stopping at the first ancestor
holding exactly one `Edit` button — an outer container holds every listing, so an
unbounded walk matches the wrong row. Compare names with punctuation squashed: rows
print `1x Name` with a multiplication sign, and `.replace(/\u00d7/g,'x')` was observed
not to fire through the bridge.

## Inventory page
`https://metaforge.app/profile/<handle>?game=arc-raiders&tab=inventory`, live-synced.
Item names exist **only** in each slot's `aria-label`
(`"<Item Name>"` or `"<Item Name>, stack of <N>"`, or `"Empty inventory slot"`).
Slots: `.inventory-stash__slot-grid > div.inventory-slot`. One read returns everything;
never cache quantities, re-read at the moment of need.

## ClaudeCodeBrowser bridge limits (this install)
- `browser_eval_chain` -> `Unknown action: evalChain`
- `browser_wait_and_act` -> `Unknown action: waitAndAct`
- `browser_execute_script` must be an **expression**; a top-level `return` throws
  `return not in function`. An async result is therefore parked on `window.__MF_JOB`
  and read back with a second call.
- **A `\uXXXX` escape does not survive injection.** It arrives in the page as a
  literal backslash-u, which silently turns a regex into one that never matches
  and a `split` into one that never splits -- no error, just empty results.
  Verified twice: once on an early `.replace(/\u00d7/g,'x')`, and again on
  2026-10-23 when `[x\u00d7]` and `split('\u00b7')` both read back empty against
  rows that plainly contained those characters.
  `src/browser/runtime.js` therefore contains **no non-ASCII character at all**,
  in code or comments, and a test in `test/driver.test.js` enforces that. Match
  such characters by class instead: the row's multiplication sign is `[^\s\d]?`
  and the meta line's middle dot is `\s+[^\s\w:]\s+`.

## Reading My Listings cheaply
`window.MF.readListings()` is **synchronous** -- it returns from the same call that
asks, with nothing parked on `window.__MF_JOB`, so one browser call reads the whole
table (`npm run payload:listings`). Each row projects to:

```json
{ "side": "selling", "quantity": 1, "item": "Anvil Blueprint",
  "price": "2x Kinetic Converter", "chats": 0,
  "listedAt": "Listed yesterday - 09:55 PM", "note": "recreate: set to 200" }
```

Rows are found by walking up from each `Edit` button to the **largest** ancestor
still holding exactly one of them. Never read this table with
`browser_get_elements`: it returns every element's class array, geometry and full
selector path, which has twice exceeded the tool's output cap on a nine-row page
(~70,000 characters for what this projection says in ~700).

`note` is operator-supplied page content and is kept in its own field precisely so
it is never mistaken for part of the listing or for an instruction (CLAUDE.md #10).

## Measured (live dry runs, 2026-10-22)
| Job | In-page time | Browser calls |
|---|---|---|
| 1 barter listing (fill, verify, cancel) | 3.3 s | 3 |
| 1 seeds listing + note | 2.1 s | 3 |
| 3 barter listings in one job | 9.0 s (3.0 s each) | 4 (1 job + 2 polls) |
| 7 listings created for real | 25.2 s (3.6 s each) | 4 |
| 4 live listings repriced | ~30 s | 4 |

Stepping verified live: listing quantity 1 -> 2 -> 3, one click per increment with a
read-back between clicks. Both quantity kinds go through `stepQuantity`.

Every run reported `ok: true` with quantity, wanted items and note matching the spec.
