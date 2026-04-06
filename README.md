# venpm

Vencord Plugin Manager — install and manage userplugins from JSON indexes.

**Full documentation: [venpm.dev](https://venpm.dev)**

## Install

```bash
npm install -g @kamaras/venpm
```

Or run without installing:

```bash
npx @kamaras/venpm doctor
```

Requires Node.js 18+.

## Quick Start

```bash
venpm doctor                          # check environment
venpm config set vencord.path ~/Vencord

venpm search betterFolders            # find plugins
venpm install BetterFolders           # install a plugin
venpm list                            # list installed plugins
venpm update                          # update all plugins
venpm rebuild                         # rebuild Vencord
```

## For Plugin Authors

```bash
venpm create my-plugins               # scaffold a new plugin repo
venpm create my-plugins/MyPlugin      # scaffold a plugin inside a repo
venpm validate plugins.json           # validate your index file
```

See [Publishing Plugins](https://venpm.dev/author/your-first-plugin) for the full walkthrough.

## How It Works

1. Authors publish a `plugins.json` index file ([spec](https://venpm.dev/author/plugin-index)) somewhere reachable — GitHub Releases, a raw URL, or any static host.
2. Users add that URL with `venpm repo add <url>`.
3. `venpm install <plugin>` resolves dependencies, fetches via git or tarball, and optionally rebuilds Vencord.

## Development

```bash
git clone https://github.com/theokyr/venpm.git && cd venpm
node scripts/setup.mjs
```

```bash
npm run dev          # watch mode
npm test             # 224 tests
npm run lint         # type check
```

## License

MIT
