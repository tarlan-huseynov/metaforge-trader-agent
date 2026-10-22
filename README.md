# MetaForge ARC Raiders trading agent

A local listing registry plus a page-side runtime that Claude Code drives through the
operator's own Firefox (ClaudeCodeBrowser MCP). There is no MetaForge API integration:
every listing is created by filling the site's real form and reading it back.

## Requirements
- Node.js 20+ (no dependencies)
- Firefox with the ClaudeCodeBrowser extension and its MCP server connected
- Your own MetaForge account, logged in by you, on the My Listings page

## How it works
```
  trade phrase            structured spec              one-line payload
"anvil bp for 2 kinetics" ───▶ {item, quantity, ───▶ window.MF.run({...}) ───▶ MetaForge form
                               price, perUnit}                                 │
                                                        window.__MF_JOB ◀──────┘
                                                        (read back + verified)
```
- Item names resolve against `data/items.json`, a cache of names seen verbatim in
  MetaForge's own autocomplete. Ambiguous or unknown names fail loudly.
- Per-unit prices are multiplied by the listing quantity exactly once, in code.
- Quantities are written with the native value setter and asserted on read-back;
  the UI's `+`/`-` buttons are never clicked (they double-registered, turning 2 into 12).
- A dry run fills and verifies the whole form, then cancels. Only `--commit` submits,
  and only for listings already in status `approved`.
- A listing is marked published only when the job result carried page evidence.

## Commands
```bash
npm run help
npm run plan -- "snap hook bp for 3 kinetics"      # parse only
npm run add  -- "anvil bp for 2 kinetics" --note "1 bp for 2 kinetics"
npm run list
npm run approve -- --status draft
npm run payload:install                            # paste into browser_execute_script
npm run payload:create                             # dry run (add --commit to submit)
npm run apply-result -- --json '<window.__MF_JOB>'
npm run items:find -- --query "snap hook"
npm run items:add -- --name "Exact Name" --category blueprint
npm test
npm run bench
```
`MF_DATA_DIR` points the registry at another directory (the tests use it).

## Docs
- `docs/playbook.md` — the four-step run loop and the rules that do not bend
- `docs/dom-contract.md` — verified selectors, the wizard's screens, bridge limits
- `CLAUDE.md` — operating instructions for Claude Code

## Scope and safety
One local operator. No file locking, no pricing engine, no remote modification or
deletion, no automatic publishing. Keep `data/` private. Confirm MetaForge's rules
permit the automation you intend; stop and hand back any CAPTCHA or security challenge.
