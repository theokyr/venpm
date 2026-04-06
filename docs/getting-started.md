# Getting Started

## Install

```bash
npm install -g venpm
```

Or run without installing:

```bash
npx venpm <command>
```

Requires Node.js 18+.

## First Run

Run `doctor` to check your environment:

```bash
venpm doctor
```

This reports the status of:
- `git` (needed for git-based installs)
- `pnpm` (needed for Vencord rebuild)
- Vencord source path
- Discord binary

Set your Vencord source path if it was not auto-detected:

```bash
venpm config set vencord.path /path/to/Vencord
```

You can also set it via the `VENPM_VENCORD_PATH` environment variable.

## Installing Plugins

Search for a plugin across all configured repos:

```bash
venpm search betterFolders
```

Install a plugin:

```bash
venpm install BetterFolders
```

venpm fetches the plugin (via git clone or tarball), writes it to
`<vencord>/src/userplugins/`, and updates the lockfile. If `rebuild` is set
to `ask` (default), it will prompt you to rebuild Vencord.

### Install options

```bash
venpm install BetterFolders --version 1.2.0     # pin to a specific version
venpm install BetterFolders --from myrepo        # install from a specific repo
venpm install BetterFolders --git                # force git clone
venpm install BetterFolders --tarball            # force tarball download
venpm install BetterFolders --no-build           # skip rebuild
venpm install BetterFolders --rebuild            # always rebuild
venpm install MyPlugin --local ./path/to/plugin  # symlink a local directory
```

## Managing Plugins

```bash
venpm list                  # list all installed plugins
venpm update                # update all non-pinned plugins
venpm update BetterFolders  # update a specific plugin
venpm uninstall BetterFolders
venpm info BetterFolders    # show plugin details from index
```

Rebuild Vencord manually:

```bash
venpm rebuild
```

## Adding Repos

By default, venpm ships with one repo configured. To add more:

```bash
venpm repo add https://example.com/plugins.json
venpm repo add https://example.com/plugins.json --name myrepo
venpm repo list
venpm repo remove myrepo
```

The URL must point to a `plugins.json` that conforms to the [venpm index format](index-format.md).

## For Developers

### Create a plugin repo

```bash
venpm create my-plugins
cd my-plugins
```

This scaffolds a `plugins.json`, a `plugins/` directory, and a GitHub Actions
workflow that validates your index on every push.

### Add a plugin to the repo

```bash
venpm create my-plugins/MyPlugin          # plain TypeScript
venpm create my-plugins/MyPlugin --tsx    # with React (.tsx)
venpm create my-plugins/MyPlugin --css    # add style.css
venpm create my-plugins/MyPlugin --native # add native.ts
```

venpm detects whether `my-plugins` contains a `plugins.json` and automatically
scaffolds a plugin entry instead of a repo.

### Validate your index

```bash
venpm validate plugins.json           # schema validation
venpm validate plugins.json --strict  # also checks dependency refs + tarball URLs
```

Exit code is 0 on success, 1 on failure — suitable for CI.

## Configuration

Config file location:

| Platform | Path |
|----------|------|
| Linux | `~/.config/venpm/config.json` |
| macOS | `~/Library/Application Support/venpm/config.json` |
| Windows | `%APPDATA%\venpm\config.json` |

```bash
venpm config path               # print config directory
venpm config get vencord.path   # read a value
venpm config set vencord.path /path/to/Vencord
venpm config set rebuild always
venpm config set discord.restart never
```

### Rebuild modes

| Value | Behaviour |
|-------|-----------|
| `ask` | Prompt after each install/uninstall (default) |
| `always` | Rebuild automatically |
| `never` | Never rebuild |

The same values apply to `discord.restart`.

## Automation

Pass `-y` / `--yes` to skip all confirmation prompts:

```bash
venpm install BetterFolders --yes
venpm update --yes
venpm uninstall BetterFolders --yes
```

Useful in scripts and CI pipelines.
