# venpm

Vencord Plugin Manager — CLI and JSON index spec for distributing userplugins.

## Quick Reference

```bash
node scripts/setup.mjs          # First-time dev setup (install, build, link globally)
npm run dev                      # Watch mode (auto-rebuild, global venpm updates live)
npm test                         # Run all 224 tests
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
    prompt.ts                    # Interactive prompts (--yes auto-confirms)
    log.ts                       # Structured output (--verbose/--quiet)
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
- `prompter` — interactive prompts (confirm, input, select)
- `logger` — structured output (info, warn, error, verbose, success)

`src/cli/context.ts` provides `createRealIOContext()` which wires real Node.js APIs. Tests inject mocks.

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

224 tests across 3 layers:

| Layer | Location | What |
|-------|----------|------|
| Unit | `tests/unit/` | Pure functions: resolver, registry, config, lockfile, schema, detect, cache, etc. |
| Integration | `tests/integration/` | Full install/uninstall/create flows with mocked IOContext |
| E2E | `tests/e2e/` | Compiled CLI as subprocess against real temp directories |

### Writing Tests

- Use `mockFs()` helpers (see existing tests) for filesystem mocking
- Mock `HttpClient` with response objects matching the interface
- Integration tests should test `execute*()` functions directly, not through commander
- E2E tests use `execFile("node", [CLI_PATH, ...args])` with temp `XDG_CONFIG_HOME`

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
