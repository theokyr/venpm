# venpm

Vencord Plugin Manager — install and manage userplugins from JSON indexes.

## Install

```bash
npx venpm doctor          # try without installing
npm install -g venpm      # or install globally
```

## Quick Start

```bash
venpm doctor                          # check environment
venpm config set vencord.path ~/src/extern/Vencord

venpm search betterFolders            # find plugins
venpm install BetterFolders           # install a plugin
venpm list                            # list installed plugins
venpm update                          # update all plugins
venpm update BetterFolders            # update one plugin
venpm rebuild                         # rebuild Vencord
```

## For Plugin Authors

```bash
venpm create my-plugins               # scaffold a new plugin repo
venpm create my-plugins/MyPlugin      # scaffold a plugin inside a repo
venpm validate plugins.json           # validate your index file
venpm validate plugins.json --strict  # also check dependency refs + tarball URLs
```

## How It Works

- Authors publish a `plugins.json` index file (the venpm index spec) somewhere reachable — GitHub Releases, a raw URL, or any static host.
- Users add that URL with `venpm repo add <url>` — venpm fetches and caches the index.
- `venpm install <PluginName>` resolves the plugin across all configured repos, generates an install plan (including transitive dependencies), and fetches the plugin via git clone or tarball download.
- Optionally, venpm calls `pnpm build` in the Vencord source tree and copies the output to Discord's load path.

## Development

```bash
git clone <repo-url> && cd venpm
node scripts/setup.mjs        # install, build, link globally
```

This gives you a working `venpm` command. The setup script:
1. Checks Node.js >= 18, npm, and optional tools (git, pnpm)
2. Installs dependencies
3. Compiles TypeScript
4. Links `venpm` globally via `npm link`

After setup:
```bash
npm run dev                    # watch mode — auto-rebuild on changes
npm test                       # run tests
npm run lint                   # type check
npm run unsetup                # remove global link
```

## Docs

- [Getting Started](docs/getting-started.md)
- [Plugin Index Format](docs/index-format.md)

## License

MIT
