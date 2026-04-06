# Plugin Index Format

A venpm plugin index is a JSON file (`plugins.json`) hosted at a stable URL. Users point venpm at the URL with `venpm repo add`; venpm fetches and caches the index to resolve and install plugins.

The canonical JSON Schema is:

```
https://venpm.dev/schemas/v1/plugins.json
```

## Example

```json
{
  "$schema": "https://venpm.dev/schemas/v1/plugins.json",
  "name": "my-plugins",
  "description": "My custom Vencord plugins",
  "plugins": {
    "BetterFolders": {
      "version": "1.2.0",
      "description": "Enhanced server folder UI",
      "authors": [{ "name": "kamaras", "id": "123456789" }],
      "license": "MIT",
      "source": {
        "git": "https://github.com/example/my-plugins.git",
        "path": "plugins/BetterFolders"
      },
      "versions": {
        "1.2.0": { "git_tag": "v1.2.0" },
        "1.1.0": { "git_tag": "v1.1.0", "tarball": "https://github.com/example/my-plugins/releases/download/v1.1.0/BetterFolders.tar.gz" }
      }
    },
    "QuickSearch": {
      "version": "0.3.1",
      "description": "Fuzzy search for channels and DMs",
      "authors": [{ "name": "kamaras", "id": "123456789" }],
      "dependencies": ["BetterFolders"],
      "source": {
        "tarball": "https://github.com/example/my-plugins/releases/latest/download/QuickSearch.tar.gz"
      }
    }
  }
}
```

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | no | JSON Schema URL — enables IDE validation |
| `name` | string | yes | Repository identifier. Pattern: `[a-zA-Z0-9_-]+` |
| `description` | string | yes | Human-readable description of this repo |
| `plugins` | object | yes | Map of plugin name to plugin entry |

## Plugin Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | yes | Current/latest semver version (e.g. `1.2.0`) |
| `description` | string | yes | What the plugin does |
| `authors` | array | yes | At least one `{ name, id }` object |
| `source` | object | yes | Where to fetch the plugin (see below) |
| `license` | string | no | SPDX license identifier (e.g. `MIT`) |
| `dependencies` | array | no | Names of other plugins in this index that must be installed first |
| `discord` | string | no | Informational Discord version range |
| `vencord` | string | no | Informational Vencord version range |
| `versions` | object | no | Named version history (version string → `VersionEntry`) |

### Author Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name |
| `id` | string | yes | Discord user ID (as string) |

## Source Object

At least one of `git` or `tarball` must be present.

| Field | Type | Description |
|-------|------|-------------|
| `git` | string | Git clone URL |
| `path` | string | Subdirectory within the git repo (for monorepos). Omit for single-plugin repos. |
| `tarball` | string (URI) | Direct download URL for a `.tar.gz` archive of the plugin folder |

venpm prefers `git` when git is available, and falls back to `tarball`. Use `--git` or `--tarball` flags on `install` to force either method.

## Version History (`versions`)

The optional `versions` map lets venpm install specific older releases. Keys are semver strings; values are `VersionEntry` objects:

| Field | Type | Description |
|-------|------|-------------|
| `git_tag` | string | Git tag for this version |
| `tarball` | string (URI) | Tarball URL for this specific version |

Users can target a specific version with `venpm install <plugin> --version 1.1.0`.

## Compatibility Fields

`discord` and `vencord` are purely informational. venpm displays them in `venpm info` output but **never uses them to block an install**. Compatibility enforcement would require runtime version detection that is out of scope for a package manager — users see the ranges and decide.

## Hosting Options

### GitHub Releases (recommended)

Use a GitHub Actions workflow to publish `plugins.json` as a release asset on every push to main. venpm's `create` command scaffolds this workflow automatically.

Users then point venpm at the stable latest-release URL:

```
https://github.com/<user>/<repo>/releases/latest/download/plugins.json
```

### Raw GitHub

For repos without releases, host the file directly in the repo and point at the raw URL:

```
https://raw.githubusercontent.com/<user>/<repo>/main/plugins.json
```

### Any Static Host

venpm fetches the URL with a plain HTTP GET. Any server that returns valid JSON with the correct Content-Type works — Gitea, self-hosted static sites, CDN, etc.

## CI Integration

Validate your index on every push with a single step:

```yaml
- name: Validate plugins.json
  run: npx venpm validate plugins.json
```

For thorough validation that also checks dependency cross-references and probes tarball URLs:

```yaml
- name: Validate plugins.json (strict)
  run: npx venpm validate plugins.json --strict
```

`venpm validate` exits with code 0 on success and 1 on failure.
