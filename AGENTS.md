# venpm

Vencord Plugin Manager CLI. Follow the repo guidance in `CLAUDE.md`; the notes below are the Codex-specific entry points.

## DiscordMCP For Codex

Use the shared Discord MCP proxy from `vencord-plugins`:

```json
{
  "command": "node",
  "args": ["/Users/theo/src/vencord-plugins/proxy/dist/index.js"]
}
```

Codex uses user-level MCP config in `~/.codex/config.toml`, not this repo's `.mcp.json`. The repo `.mcp.json` is present for project-scoped MCP clients and points at the same proxy as `~/src/vencord-plugins`.

Expected flow:

1. Codex starts the `discord` MCP server.
2. The proxy listens on stdio for MCP and on `127.0.0.1:21420` for Discord.
3. The `DiscordMCP` Vencord plugin connects from the running Discord client.

If tools report Discord is disconnected, start Discord and make sure the `DiscordMCP` plugin is enabled in Vencord.

## Agent Rules

- Use DiscordMCP tools for live Discord/plugin investigation when available.
- For plugin build and deploy from agent context, prefer `discord_rebuild_plugins`; fall back to `venpm rebuild` only if MCP is unavailable.
- If `discord_rebuild_plugins` auto-denies because the user is in a voice call, stop and tell the user. Do not bypass the denial.
- Use `--json` or `--json-stream` for agent/CI-facing venpm commands that need machine-readable output.
- Pass `--yes` explicitly for non-interactive venpm commands that would otherwise prompt. `--json` and `--json-stream` already imply `--yes`.

## Verification

Run focused checks from this repo with:

```bash
npm test
npm run lint
```
