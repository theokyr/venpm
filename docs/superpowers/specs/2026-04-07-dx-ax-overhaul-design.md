# venpm DX & AX Overhaul — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Full DX pass — output layer, error experience, interactive UX, agentic contracts

## Summary

Replace venpm's plain-text Logger with a Layered Renderer architecture that adapts output to the consumer: colored TTY for humans, plain text for pipes, JSON envelope for scripts, NDJSON streaming for agents. Add structured error codes, fuzzy matching, shell completions, first-run setup, and branded help. Update all tests, docs, and agent-facing documentation.

## Requirements

- **Brand:** Carbon Forest Amber (DESIGN.md) — cargo-style power-user tone with amber warmth
- **Audience:** Interactive humans, AI agents (Claude Code etc.), CI pipelines — all first-class
- **Progress:** Animated TTY overwrite + discrete fallback for non-TTY
- **JSON:** Keep `--json` envelope (upgraded to v2), add `--json-stream` for live NDJSON
- **Errors:** Structured error codes, actionable suggestions, fuzzy "did you mean"
- **Interactive:** Styled prompts, shell completions, custom help, first-run experience
- **Docs:** All CLAUDE.md files, venpm-docs site, and agent skills fully updated

## 1. Renderer Interface & Event Model

Commands emit semantic events through a `Renderer` interface that replaces `Logger` in `IOContext`.

```ts
interface Renderer {
  // Text output
  text(message: string): void;
  heading(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(info: ErrorInfo): void;
  verbose(message: string): void;
  dim(message: string): void;

  // Structured output
  table(headers: string[], rows: string[][]): void;
  keyValue(pairs: [string, string][]): void;
  list(items: string[]): void;

  // Progress
  progress(id: string, message: string): ProgressHandle;

  // Raw
  write(data: string): void;
}

interface ProgressHandle {
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
}

interface ErrorInfo {
  code: string;
  message: string;
  suggestion?: string;
  candidates?: string[];
  docsUrl?: string;
}
```

### Renderer Implementations

| Renderer | When Selected | Behavior |
|----------|--------------|----------|
| **TtyRenderer** | stdout is TTY, no `NO_COLOR`, no `CI` | Color, spinners, overwriting progress |
| **PlainRenderer** | `!isTTY \|\| NO_COLOR \|\| CI` | No ANSI, discrete lines |
| **JsonRenderer** | `--json` | Collects events, writes final envelope |
| **StreamRenderer** | `--json-stream` | Writes NDJSON per event |

Selection logic in `createRealIOContext()`:

```
--json-stream  → StreamRenderer
--json         → JsonRenderer
!process.stdout.isTTY || NO_COLOR || CI  → PlainRenderer
FORCE_COLOR set → TtyRenderer (even if not TTY)
else           → TtyRenderer
```

## 2. Color System & ANSI

New `src/core/ansi.ts` — zero dependencies. Uses 24-bit true color mapped from DESIGN.md:

| Function | Hex | Usage |
|----------|-----|-------|
| `amber()` | `#f97316` | Brand accent — commands, plugin names, prompts |
| `emerald()` | `#34d399` | Success only — `✔` lines |
| `red()` | `#ef4444` | Errors — `✖` lines |
| `yellow()` | `#fbbf24` | Warnings — `⚠` lines |
| `dim()` | `#4a5c56` | Muted — timestamps, hints, secondary info |
| `bright()` | `#e8e8e8` | Headings, emphasis |
| `bold()` | N/A | Bold weight |

Each function is a no-op pass-through when color is disabled. TtyRenderer holds a `colors: boolean` flag.

**Environment signals:**
- `NO_COLOR` set → no color
- `FORCE_COLOR` set → color even in non-TTY
- `CI=true` → no color (PlainRenderer selected anyway)

### Terminal Output Examples

**`venpm install BetterVolume`:**
```
  ⟩ Fetching indexes...
  ✔ 2 repos, 47 plugins
  ⟩ Resolving dependencies...
  ✔ Install plan:
    BetterVolume@1.2.0 via git
    _libAnimationKit@0.3.1 via git (dependency)

  Proceed? [Y/n]

  ⟩ Cloning BetterVolume...
  ✔ BetterVolume installed
  ⟩ Cloning _libAnimationKit...
  ✔ _libAnimationKit installed
  ✔ Successfully installed BetterVolume
```

- `⟩` sigil in amber (venpm's progress marker — matches logo arrow motif)
- `✔` in emerald, `✖` in red, `⚠` in yellow
- Plugin names in amber, versions dim, method labels dim
- "Y" in confirm prompts in amber

**`venpm list`:**
```
  Installed plugins (3):

  BetterVolume          1.2.0   git     community
  _libAnimationKit      0.3.1   git     community    (dependency)
  CustomCSS             2.0.0   local   local        pinned
```

**`venpm doctor`:**
```
  ✔ git          available
  ✔ pnpm         available
  ~ Vencord      ~/src/Vencord (auto-detected)
  ✗ Discord      not found
  ✔ Repos        2 configured
  ✔ venpm        0.1.1
```

## 3. Structured Errors & Error Codes

### Error Catalog

| Code | When | Default Suggestion |
|------|------|-------------------|
| `VENCORD_NOT_FOUND` | No Vencord path in config or detected | `Run: venpm config set vencord.path /path/to/Vencord` |
| `PLUGIN_NOT_FOUND` | Plugin name doesn't match any index | `Run: venpm search <partial>` (+ fuzzy candidates) |
| `PLUGIN_AMBIGUOUS` | Found in multiple repos, no `--from` | `Run: venpm install <plugin> --from <repo>` |
| `PLUGIN_NOT_INSTALLED` | Uninstall/update target not installed | `Run: venpm list to see installed plugins` |
| `REPO_FETCH_FAILED` | HTTP error fetching index | `Check URL with: venpm repo list` |
| `GIT_NOT_AVAILABLE` | Git required but not found | `Install git, or use --tarball` |
| `PNPM_NOT_AVAILABLE` | Rebuild needs pnpm | `Install pnpm: npm i -g pnpm` |
| `CIRCULAR_DEPENDENCY` | Dep graph has a cycle | Shows the cycle path |
| `VERSION_NOT_FOUND` | `--version` specifies nonexistent version | `Run: venpm info <plugin> to see available versions` |
| `SCHEMA_INVALID` | plugins.json fails validation | Shows path + first validation error |
| `BUILD_FAILED` | Vencord pnpm build failed | `Run: venpm doctor to check your environment` |
| `DISCORD_NOT_FOUND` | Can't find Discord binary to restart | `Set: venpm config set discord.binary /path/to/discord` |
| `NON_INTERACTIVE` | Prompt needed but no TTY | `Use --yes to auto-confirm, or set config explicitly` |

### Rendering

**TTY:**
```
✖ Plugin "BeterVolume" not found in any configured repo
  ⟩ Did you mean: BetterVolume
  ⟩ Run: venpm search volume
                                              [PLUGIN_NOT_FOUND]
```

**JSON (`--json`):**
```json
{
  "success": false,
  "error": {
    "code": "PLUGIN_NOT_FOUND",
    "message": "Plugin \"BeterVolume\" not found in any configured repo",
    "suggestion": "Did you mean: BetterVolume",
    "candidates": ["BetterVolume"]
  }
}
```

**NDJSON (`--json-stream`):**
```json
{"type":"error","success":false,"error":{"code":"PLUGIN_NOT_FOUND","message":"Plugin \"BeterVolume\" not found in any configured repo","suggestion":"Did you mean: BetterVolume","candidates":["BetterVolume"]}}
```

## 4. Fuzzy Matching

New `src/core/fuzzy.ts` — Levenshtein distance, ~20 lines, zero deps.

**Applies to:**
- Plugin names in `install`, `info`, `uninstall`, `update`
- Repo names in `--from`
- Config keys in `venpm config set/get`

**Logic:**
1. Collect candidate list from cached indexes / lockfile / config
2. Compute Levenshtein distance for each candidate vs input
3. Filter: `distance <= max(2, input.length * 0.4)`
4. Sort by distance, return top 3

**Rendering:**
- Single match: `Did you mean: BetterVolume`
- Multiple matches: `Did you mean one of:` + bulleted list
- JSON/NDJSON: `candidates` array in ErrorInfo

## 5. Progress & Spinners

**TtyRenderer:**
- Spinner using `⟩` sigil with subtle pulse animation (~120ms interval)
- Overwrites current line via `\r\x1b[K`
- `succeed()` → emerald `✔`, `fail()` → red `✖`
- Nested progress stacks lines, each independently resolved

**PlainRenderer:**
- `progress()` prints message as a line
- `update()` prints new line
- `succeed()`/`fail()` print `✔`/`✖` (no ANSI)

**JsonRenderer:**
- Progress events silently collected, not written

**StreamRenderer:**
- Each event emits NDJSON:
```json
{"type":"progress","id":"fetch-community","message":"Fetching \"community\"..."}
{"type":"progress","id":"fetch-community","status":"done","message":"\"community\" — 47 plugins"}
```

**Implementation:** Single `setInterval` in TtyRenderer drives spinner. All handles share it. Cleared on process exit.

**Operations with progress:**
- Index fetching (per-repo)
- Git clone / tarball download
- Vencord rebuild
- Dependency resolution (only if >5 plugins in graph)

## 6. Interactive Experience

### Styled Prompts

Built on `readline/promises` with ANSI formatting. No external deps.

```
  ? Proceed with installation? (Y/n)
  ? Remove plugin "BetterVolume"? (y/N)
```

- Amber `?` prefix, bright question text, dim hint
- Destructive actions default to N

**Select prompts** get arrow-key navigation (implemented via raw mode stdin — `process.stdin.setRawMode(true)` — no external deps):
```
  ? Plugin found in multiple repos:
    ❯ community
      official
      local-dev
```

Amber `❯` for selected item. Falls back to numbered input (current behavior) when raw mode is unavailable. The `Prompter` interface stays the same — only the TTY presentation changes.

### First-Run Experience

Triggers when `config.json` doesn't exist, only for commands that need config (not `--help`, `--version`).

```
  venpm v0.1.1

  First time? Let's set up.

  ? Vencord source path: ~/src/Vencord
  ? Add the community plugin repo? (Y/n)
  ✔ Config saved to ~/.config/venpm/config.json

  Run venpm search to browse available plugins.
```

Non-interactive mode: skips setup, errors with `NON_INTERACTIVE` code + suggestion to run `venpm doctor` first.

### Shell Completions

Commander's built-in completion support. Exposed via `venpm completions bash|zsh|fish`.

Completes:
- Command names
- `--from <repo>` → configured repo names
- `uninstall`, `update`, `info` → installed plugin names (from lockfile)
- `install` → available plugin names (from cached index)

### Custom Help

Override commander's default help with branded output:

```
  venpm — Vencord Plugin Manager

  USAGE
    venpm <command> [options]

  COMMANDS
    install <plugin>     Install a plugin and its dependencies
    uninstall <plugin>   Remove a plugin
    update [plugin]      Update one or all plugins
    list                 List installed plugins
    search <query>       Search available plugins
    info <plugin>        Show plugin details
    repo                 Manage plugin repositories
    config               View and set configuration
    create               Scaffold a new plugin or repo
    rebuild              Rebuild Vencord
    doctor               Check environment health
    validate             Validate a plugins.json file
    completions          Output shell completion script

  OPTIONS
    -y, --yes            Auto-confirm all prompts
    --json               Output final result as JSON
    --json-stream        Output events as NDJSON
    --verbose            Enable verbose output
    --quiet              Suppress non-essential output
    --no-color           Disable colored output
    --version            Show version
    --help               Show help

  DOCS  https://venpm.dev
```

Amber command names, dim descriptions, bright section headers. `DOCS` footer always present.

## 7. JSON & NDJSON Contracts

### `--json` Envelope v2

```ts
interface JsonEnvelope<T = unknown> {
  success: boolean;
  error?: ErrorInfo;      // was: string — now structured
  data?: T;
  warnings?: string[];    // promoted from inside data to top-level
}
```

Breaking change from v1: `error` field changes from `string` to `ErrorInfo`. Documented as v2.

### `--json-stream` NDJSON

```ts
type StreamEvent =
  | { type: "progress"; id: string; message: string }
  | { type: "progress"; id: string; status: "done" | "fail"; message: string }
  | { type: "warning"; message: string; code?: string }
  | { type: "log"; message: string }
  | { type: "result"; success: true; data: unknown; warnings?: string[] }
  | { type: "error"; success: false; error: ErrorInfo }
```

Every stream ends with exactly one `result` or `error` event. Final event shape matches `--json` envelope — shared parsing code.

`--json-stream` implies `--yes` (same as `--json`).

### Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | Command error (plugin not found, validation failed, etc.) |
| 2 | Usage error (bad arguments, missing required args) |
| 3 | Environment error (git missing, no Vencord path, build failed) |

## 8. File Structure

### New Files

```
src/core/
  ansi.ts              # Color functions, NO_COLOR/FORCE_COLOR detection
  fuzzy.ts             # Levenshtein distance, candidate matching
  errors.ts            # ErrorInfo type, error catalog (code → default suggestion)
  renderer.ts          # Renderer interface + TtyRenderer, PlainRenderer
  json-renderer.ts     # JsonRenderer (final envelope)
  stream-renderer.ts   # StreamRenderer (NDJSON)
  progress.ts          # ProgressHandle, spinner animation loop

src/cli/
  completions.ts       # venpm completions bash|zsh|fish
  first-run.ts         # Config existence check, guided setup flow
  help.ts              # Custom help formatter
```

### Modified Files

```
src/core/types.ts      # Renderer replaces Logger in IOContext, ErrorInfo, StreamEvent
src/core/prompt.ts     # Styled prompts (ANSI), arrow-key select
src/core/json.ts       # Updated envelope (error: string → ErrorInfo), warnings promoted
src/cli/context.ts     # Renderer selection logic, --json-stream flag
src/index.ts           # Register completions, custom help, --json-stream, --no-color
src/cli/install.ts     # Renderer + progress + structured errors
src/cli/uninstall.ts   # Same
src/cli/update.ts      # Same
src/cli/list.ts        # renderer.table() / renderer.keyValue()
src/cli/search.ts      # renderer.table()
src/cli/info.ts        # renderer.keyValue()
src/cli/doctor.ts      # renderer.keyValue() with status sigils
src/cli/create.ts      # Renderer + structured errors
src/cli/rebuild.ts     # Renderer + progress
src/cli/validate.ts    # Renderer + structured errors
src/cli/repo.ts        # renderer.table()
src/cli/config-cmd.ts  # Renderer + fuzzy match on config keys
```

### Deleted Files

```
src/core/log.ts        # Fully replaced by renderer.ts
```

### Dependency Rules

- `ansi.ts`, `fuzzy.ts`, `errors.ts` — zero imports from other core modules (leaf modules)
- `renderer.ts` imports `ansi.ts`, `errors.ts`, `progress.ts`
- `json-renderer.ts`, `stream-renderer.ts` import `errors.ts` only
- `prompt.ts` imports `ansi.ts` (for styled prompts)
- No renderer imports from `cli/`

## 9. Documentation & Test Updates

### Tests

- All ~240 existing tests updated: mock `Renderer` instead of `Logger`
- New unit tests: `ansi.ts`, `fuzzy.ts`, `errors.ts`
- New unit tests: each renderer implementation (Tty, Plain, Json, Stream)
- Integration tests: updated for JSON v2 envelope
- E2E tests: exit codes (0/1/2/3), `--json` v2, `--json-stream` NDJSON, `--no-color`
- New E2E tests: `venpm completions`, first-run flow, fuzzy match suggestions

### venpm CLAUDE.md

- Architecture section: Renderer replaces Logger, new modules listed
- IOContext Pattern section: Renderer interface, selection logic
- Non-Interactive Mode section: `--json-stream`, exit code semantics
- New Error Codes section: full catalog
- Testing section: renderer mocking patterns

### venpm-docs (venpm.dev)

- CLI reference: `--json-stream`, `--no-color`, `venpm completions`
- JSON API page: v2 envelope, NDJSON events, v1→v2 migration note
- New Error Codes reference page
- Author Guide: updated `venpm validate` output
- Terminal screenshots updated for colored output

### Agent Skills (agents repo)

- `venpm-ecosystem` skill: `--json-stream` for agentic use, exit codes, error code parsing
- `venpm-scrub` skill: new files exclusion if needed
- `venpm-deploy` skill: any deploy workflow changes

### DESIGN.md (venpm-docs)

- New CLI section: terminal color mapping (brand → ANSI), `⟩` sigil, output patterns
