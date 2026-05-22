# Code Review - venpm and vencord-plugins - 2026-05-16

Scope: current working tree of `/home/theo/src/venpm` plus `/home/theo/src/vencord-plugins`. The `venpm` tree had existing uncommitted changes before this review (`package-lock.json`, `src/core/json.ts`, `src/core/log.ts`, and matching tests), so this review covers the working tree as-is.

## Verification

- `cd /home/theo/src/venpm && npm run build`: passed.
- `cd /home/theo/src/venpm && npm test`: failed: 8 e2e failures, all caused by empty stdout/stderr from child-process CLI invocations.
- `cd /home/theo/src/vencord-plugins && npm test`: passed, 301 tests.
- `cd /home/theo/src/vencord-plugins/proxy && npm run build`: passed.

## Findings

### P0 - venpm CLI exits before async actions and piped stdout finish

`src/index.ts:68` calls `program.parse()` even though nearly every command action and the `preAction` hook are async. Commander does not wait for async handlers through plain `parse()`. In child-process/non-interactive usage, the process can reach natural exit before `process.stdout.write()` flushes and before awaited command work completes.

Evidence:

- `tests/e2e/cli.test.ts` expects normal stdout from `node dist/index.js --help`, `--version`, `config path`, `repo list`, and `validate`, but stdout is empty in all of those child-process cases.
- `tests/e2e/json-stream.test.ts` gets no NDJSON events for `list --json-stream` and `info nonexistent --json-stream`.
- Manual reproduction from a Node parent process captures empty output for `execFile("node", ["dist/index.js", "--help"])`, even though direct terminal execution prints help.

Impact: CI, shell scripts, MCP/agent integrations, and any consumer invoking venpm through `execFile` can see empty output and incomplete side effects while receiving exit code 0.

Recommendation: switch the entry point to top-level `await program.parseAsync(process.argv)` and let async command handlers complete. Add an e2e assertion that `execFile` receives non-empty stdout for help/version/config path.

### P1 - DiscordMCP localhost WebSocket has no origin or token gate

`proxy/src/ws-server.ts:56-58` binds a WebSocket server to `127.0.0.1`, and `proxy/src/ws-server.ts:95-188` accepts any client that sends `secondary_hello`. Several sensitive read surfaces default to allow in `plugins/discordMcp/index.tsx:54-68`, including tools that expose guilds, channels, loaded messages, unread state, and subscriptions. `plugins/discordMcp/tools/read.ts:88-113` returns message content and attachment URLs.

Impact: any local process, and potentially a browser page that can open a WebSocket to localhost, can connect as a secondary client and use default-allowed read tools without an MCP client configuration step. Prompted tools are safer, but the default read surface is still enough to exfiltrate private Discord data.

Recommendation: require an unguessable shared token in the handshake and reject missing/invalid tokens before `ready` or `secondary_hello`. Also validate `Origin` for browser-originated WebSockets, and consider making read/event tools default to `prompt` until a trusted client is paired.

### P1 - Version-specific tarballs are ignored during install

`src/core/types.ts:20-23` models `VersionEntry.tarball`, but `src/core/fetcher.ts:137-142` always downloads `source.tarball` for tarball installs. By contrast, git installs use `versionEntry?.git_tag` at `src/core/fetcher.ts:128-134`.

Impact: `venpm install plugin --version 1.2.3 --tarball` can write `1.2.3` to the lockfile while downloading the latest/default tarball. That breaks reproducibility and can silently install a different plugin version than requested.

Recommendation: use `entry.versionEntry?.tarball ?? entry.source.tarball` for tarball fetches, and add resolver/fetcher tests for historical tarball versions.

### P1 - `--from` dependency resolution can use the wrong graph or crash

`executeInstall` first resolves the requested plugin with `options.from`, but then `generateInstallPlan` calls `buildDependencyGraph(indexes, pluginName)` at `src/core/resolver.ts:181`, which ignores `fromRepo`. Later, `src/core/resolver.ts:190` calls `findPlugin(indexes, name, options.fromRepo)!` for every entry, including dependencies.

Impact:

- If the same plugin name exists in an earlier repo, dependency graph construction can use that repo's dependencies even when the user selected a different repo with `--from`.
- If a dependency is intentionally provided by another repo, graph construction can find it globally, then plan construction restricts it to `fromRepo` and dereferences `null`.

Recommendation: resolve the root plugin from the selected repo first and build the graph from that concrete entry. Decide whether dependencies are allowed cross-repo; if yes, only constrain the root by `fromRepo`, not every dependency. Add tests for duplicate root names and cross-repo dependencies with `--from`.

### P2 - Scaffolded GitHub workflow uses the blocked unscoped package name

`src/cli/create.ts:105-107` writes `npx venpm validate plugins.json` into generated workflows. The ecosystem rule and package metadata both say the public npm package is `@kamaras/venpm`, not unscoped `venpm`.

Impact: newly scaffolded repos get a broken publish workflow from the official CLI.

Recommendation: generate `npx @kamaras/venpm validate plugins.json` or use `npm exec -- @kamaras/venpm validate plugins.json`. Update the e2e scaffold test to assert the scoped package name.

### P2 - Scaffolded plugin `source.local` points at the wrong directory

When creating `/repo/plugins/CoolPlugin`, `src/cli/create.ts:220-226` writes:

```json
"source": { "local": "./CoolPlugin" }
```

That path is relative to the repo root `plugins.json`, but the actual plugin directory is `./plugins/CoolPlugin`.

Impact: a scaffolded index is valid JSON but unusable for local installs unless the user manually fixes the path.

Recommendation: compute the relative path from `dirname(ancestorPluginsJson)` to `targetPath` and serialize that, normalized to POSIX separators for index portability.

### P2 - DiscordMCP permission prompts can outlive proxy timeout

The plugin sends `prompt_pending` and then waits on `requestPrompt` at `plugins/discordMcp/index.tsx:446-449`. The timeout is enforced in the proxy at `proxy/src/ws-server.ts:225-236` and `proxy/src/ws-server.ts:429-443`, but the plugin is never told to cancel the prompt.

Impact: after a proxy-side timeout, Discord can still show a stale approval UI. If the user later approves, the plugin runs the tool and sends a `tool_result` for an ID the proxy already discarded. That can create confusing UI and perform work after the caller believes the request timed out.

Recommendation: enforce the timeout on the plugin side as well, or add a `prompt_cancel` proxy message. Prompt timeout should resolve the plugin-side promise false and remove the DOM prompt.

### P3 - EmbedFix deferred multi-URL edits are not applied cumulatively

`plugins/embedFix/index.tsx:198-238` loops over pending edits, but each edit builds `newContent` from `edit.originalContent`. If a message has multiple deferred URL rewrites, each `editMessage` call can overwrite the previous rewrite because it is based on the original content rather than the last edited content. The comment at `plugins/embedFix/index.tsx:187-190` says edits are applied in reverse offset order, but the code neither sorts the edits nor keeps cumulative content.

Impact: messages with multiple uncached provider URLs may end with only one deferred rewrite applied.

Recommendation: sort the pending edits by descending offset, apply all replacements to one `currentContent` string, then call `editMessage` once.

### P3 - Primary proxy can retain secondary call routing entries after secondary timeout

When the primary proxy relays a secondary `tool_call`, it records `secondaryCallMap.set(msg.id, ws)` at `proxy/src/ws-server.ts:279-283`, but it does not create a primary-side timeout for that routed call. The secondary client has its own timeout at `proxy/src/ws-server.ts:486-494`; if that fires while the primary/plugin never responds, the primary retains the ID until the secondary disconnects or a late plugin response arrives.

Impact: long-running or dropped calls from persistent secondary clients can leak routing entries in the primary process.

Recommendation: create a primary-side timeout for relayed secondary calls and clear `secondaryCallMap` when it fires. Use the same timeout values as local `callTool`.

## Test Coverage Gaps

- No e2e test currently protects `program.parseAsync` behavior directly; the existing e2e failures reveal it, but a smaller regression test around `execFile` output would make the root cause obvious.
- Resolver tests cover cross-index dependency lookup and `findPlugin(..., fromRepo)`, but not `generateInstallPlan(..., { fromRepo })` with duplicate names or cross-repo dependencies.
- Fetcher tests cover tarballs, but not `versionEntry.tarball`.
- DiscordMCP has unit coverage for protocol/tool schemas and shared registry state, but not WebSocket authentication, secondary routing cleanup, or permission prompt timeout lifecycle.
