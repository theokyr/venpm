# venpm

Vencord Plugin Manager — CLI and JSON index spec for distributing userplugins.

## Design Spec

See `~/src/vencord-plugins/docs/superpowers/specs/2026-04-06-venpm-design.md`

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm test             # Run tests
npm run dev          # Watch mode
```

## Architecture

All I/O behind injected interfaces via `IOContext` (src/core/types.ts). CLI commands compose core modules. No global state.

- `src/core/` — Pure logic + I/O interfaces
- `src/cli/` — Command handlers (glue code)
- `schemas/` — JSON Schemas (primary deliverable)
- `tests/unit/` — Pure function tests
- `tests/integration/` — Mock I/O full-flow tests
- `tests/e2e/` — Real filesystem tests

## Constraints

- Node.js >=18 (uses built-in fetch)
- ESM only
- No native dependencies
- All I/O behind IOContext for testability
