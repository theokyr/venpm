# venpm

Vencord Plugin Manager — CLI and JSON index spec for distributing userplugins.

## Quick Reference

```bash
node scripts/setup.mjs          # First-time dev setup (install, build, link globally)
npm run dev                      # Watch mode (auto-rebuild, global venpm updates live)
npm test                         # Run all tests (~240)
npm run lint                     # Type check (tsc --noEmit)
npm run build                    # One-shot compile
npm run unsetup                  # Remove global link
```

## Architecture

**Core principle:** All I/O behind injected `IOContext` interfaces. CLI commands compose core modules. No global state.

```
src/
  core/                          # Pure logic + I/O interfaces (never import from cli/)
    types.ts                     # All interfaces: IOContext, PluginIndex, Config, Lockfile, etc.
    paths.ts                     # XDG-compliant config dir per OS
    config.ts                    # Load/save/merge config.json with defaults
    lockfile.ts                  # Immutable lockfile operations (add/remove return new objects)
    schema.ts                    # ajv validation against JSON Schemas
    detect.ts                    # Auto-detect Vencord path, Discord binary, git, pnpm
    registry.ts                  # Fetch + parse + cache plugin indexes from repos
    resolver.ts                  # Version resolution, dependency graph (topological sort), install plan
    fetcher.ts                   # Git clone (sparse checkout for monorepos), tarball extract, local symlink
    builder.ts                   # Vencord pnpm build, deploy dist, Discord restart
    cache.ts                     # HTTP index caching with ETag/Last-Modified
    prompt.ts                    # Interactive prompts (--yes auto-confirms, non-TTY errors)
    ansi.ts                      # ANSI 24-bit color (Carbon Forest Amber palette)
    fuzzy.ts                     # Levenshtein distance for "did you mean" suggestions
    errors.ts                    # ErrorInfo type, ErrorCode enum, makeError() factory
    renderer.ts                  # Renderer interface + TtyRenderer, PlainRenderer
    json-renderer.ts             # JsonRenderer for --json envelope v2
    stream-renderer.ts           # StreamRenderer for --json-stream NDJSON
    progress.ts                  # ProgressHandle for TTY spinners and plain output
  cli/                           # Command handlers (glue code, compose core modules)
    context.ts                   # createRealIOContext() — wires real Node.js I/O to IOContext
    install.ts                   # venpm install <plugin> [--version, --from, --local, --git, --tarball]
    uninstall.ts                 # venpm uninstall <plugin> (warns about reverse deps)
    update.ts                    # venpm update [plugin] (respects pinning)
    list.ts, search.ts, info.ts  # Read-only queries
    repo.ts                      # venpm repo add/remove/list
    config-cmd.ts                # venpm config set/get/path
    create.ts                    # venpm create <path> (scaffolds repo or plugin)
    rebuild.ts, doctor.ts        # Build and diagnostics
    validate.ts                  # venpm validate [--strict]
    completions.ts               # venpm completions bash|zsh|fish
    first-run.ts                 # First-run setup experience
    help.ts                      # Custom branded help formatter
  index.ts                       # CLI entry point (commander, global flags)
schemas/v1/                      # JSON Schemas — the primary deliverable
  plugins.schema.json            # Plugin index format
  config.schema.json             # venpm config format
  lockfile.schema.json           # Lockfile format
actions/publish-index/           # Reference GitHub Action for plugin repo authors
```

### IOContext Pattern

Every core module accepts its I/O dependencies as parameters — never imports `fs`, `fetch`, `child_process` directly. The `IOContext` interface (`src/core/types.ts`) defines:

- `fs` — filesystem (readFile, writeFile, exists, mkdir, rm, symlink, copyDir, etc.)
- `http` — HTTP client (fetch with headers)
- `git` — git operations (clone with sparse checkout, pull, revParse, checkout)
- `shell` — command execution (exec, spawn with detached support)
- `prompter` — interactive prompts (confirm, input, select); has `nonInteractive` mode that throws actionable errors when stdin is not a TTY (CI, agentic shells) instead of auto-confirming
- `renderer` — output adapter (text, heading, success, warn, error, table, keyValue, progress); mode selected at context creation:
  - TTY + color → TtyRenderer (amber/emerald/red ANSI)
  - TTY no color / pipe / CI → PlainRenderer (no ANSI)
  - `--json` → JsonRenderer (final envelope)
  - `--json-stream` → StreamRenderer (NDJSON per event)

`src/cli/context.ts` provides `createRealIOContext()` which wires real Node.js APIs. Tests inject mocks.

### Non-Interactive Mode

When stdin is not a TTY, prompts throw errors with instructions to use `--yes` or set config explicitly. This is intentional — auto-confirming destructive operations in CI/agentic environments is not safe. The `--yes` flag must be passed explicitly.

Both `--json` and `--json-stream` imply `--yes`. Exit codes: 0=success, 1=command error, 2=usage error, 3=environment error.

### Dependency Rules

- `core/` modules import only from `core/types.ts` and other `core/` modules — never from `cli/`
- `cli/` modules import from `core/` and `cli/context.ts`
- No circular dependencies between modules

## Plugin Index Format

The JSON Schema at `schemas/v1/plugins.schema.json` is the primary deliverable. Key fields:

- `dependencies: string[]` — required plugins, auto-installed
- `optionalDependencies: string[]` — recommended plugins, warned about but not auto-installed
- `source.git` + `source.path` — supports monorepos (sparse checkout)
- `source.tarball` — fallback when git unavailable
- `source.local` — developer workflow (symlink)
- `discord` / `vencord` — informational version ranges, never block install
- `versions` — map of version string to `{ git_tag, tarball }` for pinning

## Testing

~240 tests across 3 layers:

| Layer | Location | What |
|-------|----------|------|
| Unit | `tests/unit/` | Pure functions: resolver, registry, config, lockfile, schema, detect, cache, etc. |
| Integration | `tests/integration/` | Full install/uninstall/create flows with mocked IOContext |
| E2E | `tests/e2e/` | Compiled CLI as subprocess against real temp directories |

### Writing Tests

- Use `mockFs()` helpers (see existing tests) for filesystem mocking
- Mock `HttpClient` with response objects matching the interface
- Mock `Renderer` with vi.fn() for all 13 methods (text, heading, success, warn, error, verbose, dim, table, keyValue, list, progress, write, finish)
- Integration tests should test `execute*()` functions directly, not through commander
- Integration tests verify `renderer.finish()` call data
- E2E tests use `execFile("node", [CLI_PATH, ...args])` with temp `XDG_CONFIG_HOME`
- E2E tests verify exit codes, `--json` envelope v2, and `--json-stream` NDJSON

## Config & State

Single directory per platform:

| OS | Path |
|----|------|
| Linux | `~/.config/venpm/` (or `$XDG_CONFIG_HOME/venpm/`) |
| macOS | `~/Library/Application Support/venpm/` |
| Windows | `%APPDATA%\venpm\` |

Files: `config.json`, `venpm-lock.json`, `index-cache.json`

## Install Flow

1. Load config + lockfile + index cache
2. Fetch indexes (parallel, with ETag/Last-Modified caching)
3. Resolve plugin across repos (error if ambiguous without `--from`)
4. Build dependency graph (topological sort, circular dep detection)
5. Generate install plan (skip already-installed, select git/tarball method)
6. Warn about missing optional dependencies
7. Confirm with user (skipped with `--yes`)
8. Fetch each plugin (git sparse checkout or tarball extract)
9. Update lockfile (set `pinned: true` if `--version` used)
10. Optionally rebuild Vencord + restart Discord

## Design Spec

Full spec: see the venpm-docs repository for design documentation.

## Error Codes

| Code | When | Default Suggestion |
|------|------|-------------------|
| `VENCORD_NOT_FOUND` | No Vencord path | `venpm config set vencord.path /path` |
| `PLUGIN_NOT_FOUND` | Plugin not in any index | `venpm search <query>` + fuzzy candidates |
| `PLUGIN_AMBIGUOUS` | Multiple repos, no `--from` | `--from <repo>` |
| `PLUGIN_NOT_INSTALLED` | Uninstall/update non-installed | `venpm list` |
| `REPO_FETCH_FAILED` | HTTP error | `venpm repo list` |
| `GIT_NOT_AVAILABLE` | Git required but missing | `Install git, or --tarball` |
| `PNPM_NOT_AVAILABLE` | Rebuild needs pnpm | `npm i -g pnpm` |
| `CIRCULAR_DEPENDENCY` | Dep graph cycle | Shows cycle path |
| `VERSION_NOT_FOUND` | Nonexistent version | `venpm info <plugin>` |
| `SCHEMA_INVALID` | Validation failed | `venpm validate --strict` |
| `BUILD_FAILED` | Build error | `venpm doctor` |
| `DISCORD_NOT_FOUND` | Can't find Discord | `venpm config set discord.binary /path` |
| `NON_INTERACTIVE` | No TTY for prompts | `--yes` or set config |

## Published Package

- **npm:** `@kamaras/venpm` (scoped — unscoped "venpm" blocked by npm name-similarity check)
- **npm org:** `@kamaras` (account: `@theokyr`)
- **Current version:** 0.1.0
- **Docs:** https://venpm.dev (venpm-docs repo, GitHub Pages)
- **CI:** vitest + lint on push, npm publish on `v*` tag with manual approval gate

## Git

- **Origin:** `https://github.com/theokyr/venpm.git`
- **Branch:** `master`

## Constraints

- Node.js >= 18 (uses built-in fetch)
- ESM only (`"type": "module"`)
- No native dependencies
- All I/O behind IOContext — no direct `fs`/`fetch`/`child_process` imports in core modules
- Lockfile mutations are immutable (return new objects)
- `process.exitCode = 1; return` for errors — never `process.exit(1)`
- JSON output uses 2-space indent + trailing newline
