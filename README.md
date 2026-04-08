<p align="center">
  <img src="https://venpm.dev/logo.svg" alt="venpm" width="80" />
</p>

<h1 align="center">venpm</h1>

<p align="center">
  <strong>The package manager for Vencord userplugins.</strong><br/>
  Install, update, and manage plugins from decentralized JSON indexes.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kamaras/venpm"><img src="https://img.shields.io/npm/v/@kamaras/venpm?color=f97316&label=npm" alt="npm version" /></a>
  <a href="https://github.com/theokyr/venpm/actions"><img src="https://img.shields.io/github/actions/workflow/status/theokyr/venpm/ci.yml?label=tests&color=34d399" alt="CI" /></a>
  <a href="https://venpm.dev"><img src="https://img.shields.io/badge/docs-venpm.dev-f97316" alt="docs" /></a>
  <a href="https://github.com/theokyr/venpm/blob/master/LICENSE"><img src="https://img.shields.io/github/license/theokyr/venpm?color=94a3b8" alt="license" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-94a3b8" alt="node >= 18" /></a>
</p>

---

## Why venpm?

Vencord's userplugin ecosystem is powerful but fragmented. Plugin authors host code in personal repos, users manually clone and rebuild, and there's no dependency resolution, no update tracking, and no discoverability.

**venpm fixes this.** Authors publish a small `plugins.json` index alongside their code. Users install plugins with a single command. venpm handles dependencies, version pinning, sparse git checkouts, and Vencord rebuilds automatically.

```
venpm install minimalCallBar
  Resolved minimalCallBar@0.1.0 from kamaras-plugins
  Optional: settingsHub, channelTabs (install with venpm install <name>)
  Fetching via git (sparse checkout)...
  Installed minimalCallBar@0.1.0
  Rebuilding Vencord... done
```

## Install

```bash
npm install -g @kamaras/venpm
```

Or run without installing:

```bash
npx @kamaras/venpm doctor
```

## Quick Start

```bash
# Check your environment
venpm doctor

# Point venpm at your Vencord install
venpm config set vencord.path ~/Vencord

# Add a plugin repository
venpm repo add https://example.com/plugins.json

# Find and install plugins
venpm search betterFolders
venpm install BetterFolders
venpm list
venpm update
venpm rebuild
```

## Commands

| Command | Description |
|---------|-------------|
| `venpm install <plugin>` | Install a plugin and its dependencies |
| `venpm uninstall <plugin>` | Remove a plugin (warns about reverse deps) |
| `venpm update [plugin]` | Update one or all plugins |
| `venpm list` | Show installed plugins |
| `venpm search <query>` | Search across all configured repos |
| `venpm info <plugin>` | Show plugin details |
| `venpm repo add\|remove\|list` | Manage plugin index repositories |
| `venpm config set\|get\|path` | View or edit venpm configuration |
| `venpm create <path>` | Scaffold a new plugin repo or plugin |
| `venpm rebuild` | Rebuild Vencord after changes |
| `venpm doctor` | Diagnose environment issues |
| `venpm validate [path]` | Validate a `plugins.json` index file |

**Global flags:** `--yes` (auto-confirm), `--verbose`, `--quiet`, `--json` (structured output)

## How It Works

```
  Author                          User
  ------                          ----
  plugins.json  ──publish──>  venpm repo add <url>
       |                          |
       v                          v
  GitHub / any URL            venpm install <plugin>
                                  |
                              resolve deps
                              fetch (git sparse checkout / tarball)
                              update lockfile
                              rebuild Vencord
```

1. **Authors** publish a [`plugins.json`](https://venpm.dev/author/plugin-index) index file — a JSON document describing their plugins, versions, and sources.
2. **Users** register that URL with `venpm repo add`.
3. **venpm** resolves the full dependency graph, fetches via git (with sparse checkout for monorepos) or tarball, updates the lockfile, and optionally rebuilds Vencord.

## For Plugin Authors

```bash
# Scaffold a new plugin repository
venpm create my-plugins

# Scaffold a plugin inside an existing repo
venpm create my-plugins/MyPlugin

# Validate your index before publishing
venpm validate plugins.json --strict
```

venpm ships a **GitHub Action** for automated index publishing:

```yaml
- uses: theokyr/venpm/actions/publish-index@master
```

See the [Author Guide](https://venpm.dev/author/your-first-plugin) for the full walkthrough.

### Plugin Index Spec

The [JSON Schema](https://venpm.dev/schemas/v1/plugins.json) defines the index format. Key features:

- **Dependencies & optional dependencies** with automatic resolution
- **Monorepo support** via `source.git` + `source.path` (sparse checkout)
- **Multiple source types:** git, tarball, local symlink
- **Version pinning** with `versions` map of tag/tarball pairs
- **Informational constraints** for Discord and Vencord versions

## Architecture

```
src/
  core/           Pure logic + I/O interfaces (never imports from cli/)
    types.ts        All interfaces: IOContext, PluginIndex, Config, Lockfile
    resolver.ts     Version resolution, dependency graph, topological sort
    registry.ts     Fetch + parse + cache plugin indexes
    fetcher.ts      Git clone (sparse checkout), tarball extract, local symlink
    builder.ts      Vencord pnpm build, deploy, Discord restart
    ...             config, lockfile, schema, detect, cache, paths, prompt, log
  cli/            Command handlers (compose core modules)
    context.ts      createRealIOContext() — wires real Node.js I/O
    install.ts      uninstall.ts  update.ts  list.ts  search.ts  ...
  index.ts        CLI entry point (commander)
schemas/v1/       JSON Schemas — the primary deliverable
actions/          GitHub Action for plugin repo authors
```

**Design principle:** All I/O is injected via `IOContext` — filesystem, HTTP, git, shell, prompts, logging. Core modules never import `fs`, `fetch`, or `child_process` directly. This makes the entire core testable with pure mocks.

## Development

```bash
git clone https://github.com/theokyr/venpm.git && cd venpm
node scripts/setup.mjs    # install, build, link globally
```

```bash
npm run dev                # watch mode (live global updates)
npm test                   # 240 tests
npm run lint               # type check (tsc --noEmit)
npm run build              # one-shot compile
```

### Test Suite

240 tests across three layers:

| Layer | What it tests |
|-------|---------------|
| **Unit** | Pure functions — resolver, registry, config, lockfile, schema, detect, cache |
| **Integration** | Full command flows with mocked IOContext |
| **E2E** | Compiled CLI as a subprocess against real temp directories |

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Config & State

venpm stores configuration in a single XDG-compliant directory:

| OS | Path |
|----|------|
| Linux | `~/.config/venpm/` |
| macOS | `~/Library/Application Support/venpm/` |
| Windows | `%APPDATA%\venpm\` |

Files: `config.json`, `venpm-lock.json`, `index-cache.json`

## Documentation

Full documentation at **[venpm.dev](https://venpm.dev)** — guides, author documentation, API reference, and TypeDoc-generated internals.

## Disclaimer

venpm is not affiliated with, endorsed by, or sponsored by Discord Inc. or the Vencord project. "Discord" is a trademark of Discord Inc., mentioned solely for descriptive purposes.

Client modifications — including Vencord and any plugins installed through venpm — are against [Discord's Terms of Service](https://discord.com/terms). While no widespread bans for client mod usage are known, Discord may take action against accounts at any time. **You use client modifications entirely at your own risk.**

venpm does not review or audit third-party plugins. You are responsible for evaluating the trustworthiness of any plugin repository and plugin you install. The authors are not responsible for any damage to your Discord account, computer, or data.

This software is provided "as is", without warranty of any kind. See [LICENSE](LICENSE) for details.

## License

[MIT](LICENSE)
