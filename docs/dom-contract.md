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

```js
// 1. open the confirm dialog
[...match.row.querySelectorAll('button')]
  .find(b => (b.getAttribute('aria-label')||'') === 'Remove listing').click();
// 2. confirm
[...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')]
  .find(b => b.textContent.trim() === 'Remove').click();
// 3. re-read My Listings to confirm the row count dropped before trusting it's gone
```

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
