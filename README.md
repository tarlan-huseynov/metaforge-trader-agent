# MetaForge ARC Raiders Trading Agent

A local Node.js listing registry and dedicated Claude Code operating instructions for Firefox + ClaudeCodeBrowser MCP. **This starter does not connect to MetaForge on its own.** Claude Code performs browser actions through an independently installed, connected MCP integration.

## Requirements
- Node.js 20+
- Claude Code installed and authenticated
- Firefox with ClaudeCodeBrowser extension and its companion MCP server running, connected and registered with Claude Code (follow the extension project's current setup instructions)
- Your own authorized MetaForge account, logged in manually

## Setup
```bash
npm run list
claude
```

In Claude Code, say: `Read CLAUDE.md and help me verify the Firefox MCP connection. Inspect MetaForge read-only and report the actual listing fields. Do not publish anything.`

## Example queue
```bash
npm run add -- --item "Anvil" --quantity 5 --offer "5 Anvils" --want "20000 seeds each"
npm run list
```

## Item cache
`data/items.json` caches exact item names confirmed via MetaForge's own search, so repeat items skip a live lookup.
```bash
npm run cache:find -- --query hook
npm run cache:add -- --name "Exact Item Name" --category blueprint
```

Claude should inspect the site and request approval before creating listings. The example trade is illustrative, not a recommendation or validated market price.

## Important
Keep `data/` private. This starter assumes one local operator and does not implement file locking, browser orchestration, automatic pricing, site API requests, or automatic publishing. Confirm MetaForge's rules permit the intended automation.
