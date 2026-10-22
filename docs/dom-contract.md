# MetaForge DOM contract

Verified live on 2026-10-22 against `https://metaforge.app/arc-raiders/market/my-listings`.
Re-verify with `npm run payload:install` + a dry run whenever a step starts timing out.

## Framework notes
- Svelte + bits-ui. Dialog ids (`#bits-cNN`) change on every open — never select by id.
- The dialog is `position: fixed`, so `offsetParent` is **null** while it is visible.
  Visibility must be tested with `getClientRects().length > 0`.
- Quantity fields are plain `<input type="text">`. Writing them with the native
  value setter plus `input`/`change` events sticks across blur. Verified: `12` -> `2`.
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
| submit | `Create listing` (create) / `Save changes` (edit) |

Fields appear progressively: screen 3 starts with only the item search; quantity and
the wanted-items list render after an item is chosen.

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

Every run reported `ok: true` with quantity, wanted items and note matching the spec.
