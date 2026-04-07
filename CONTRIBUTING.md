# Contributing to venpm

Thanks for your interest in contributing to venpm! This guide covers everything you need to get started.

## Getting Started

```bash
git clone https://github.com/theokyr/venpm.git
cd venpm
node scripts/setup.mjs    # install deps, build, link globally
```

This gives you a working `venpm` command globally. Run `npm run dev` for watch mode — changes rebuild automatically and the global `venpm` stays up to date.

## Project Structure

```
src/
  core/       Pure logic + I/O interfaces
  cli/        Command handlers (glue code)
  index.ts    CLI entry point
schemas/v1/   JSON Schemas
actions/      GitHub Action for plugin authors
tests/
  unit/         Pure function tests
  integration/  Full flows with mocked IOContext
  e2e/          CLI subprocess tests
```

## The IOContext Pattern

This is the most important thing to understand. **Core modules never import Node.js I/O directly.** All filesystem, HTTP, git, shell, and prompt operations go through the `IOContext` interface defined in `src/core/types.ts`.

```typescript
// Good — accepts IOContext
export function loadConfig(io: IOContext): Promise<Config> {
  const raw = await io.fs.readFile(configPath);
  // ...
}

// Bad — imports fs directly
import { readFile } from 'fs/promises';  // NEVER in core/
```

This makes everything testable. Tests inject mock implementations instead of hitting the real filesystem or network.

### Dependency Rules

- `core/` imports from `core/` only — never from `cli/`
- `cli/` imports from `core/` and `cli/context.ts`
- No circular dependencies

## Writing Code

### Style

- **ESM only** — all files use `import`/`export`, no `require()`
- **TypeScript strict mode** — no `any` without justification
- **No direct I/O in core** — always go through IOContext
- **Immutable lockfile operations** — functions return new objects, never mutate
- **Error handling** — set `process.exitCode = 1; return` instead of `process.exit(1)`

### JSON Output

All commands support `--json` for structured output. When adding or modifying a command, ensure the JSON output path works correctly with 2-space indent and trailing newline.

### Adding a New Command

1. Create the handler in `src/cli/<command>.ts`
2. Wire it up in `src/index.ts` via commander
3. Accept `IOContext` (or build it from `createRealIOContext()`)
4. Add unit tests for any new core logic
5. Add an integration test for the command flow
6. Add an E2E test for the CLI surface

## Testing

```bash
npm test              # run all 240 tests
npm run test:watch    # re-run on changes
npm run test:coverage # generate coverage report
npm run lint          # type check (tsc --noEmit)
```

### Test Layers

| Layer | Location | Purpose | Speed |
|-------|----------|---------|-------|
| **Unit** | `tests/unit/` | Test pure functions in isolation | Fast |
| **Integration** | `tests/integration/` | Test command flows with mocked IOContext | Fast |
| **E2E** | `tests/e2e/` | Test the compiled CLI binary as a subprocess | Slower |

### Writing Tests

- Use the `mockFs()` helpers from existing tests for filesystem mocking
- Mock `HttpClient` with response objects matching the interface
- Integration tests call `execute*()` functions directly, not through commander
- E2E tests use `execFile("node", [CLI_PATH, ...args])` with a temp `XDG_CONFIG_HOME`

### Test Checklist

Before submitting, make sure:

- [ ] All existing tests pass (`npm test`)
- [ ] Type checking passes (`npm run lint`)
- [ ] New code has tests at the appropriate layer
- [ ] IOContext pattern is followed (no direct I/O imports in `core/`)

## Schemas

The JSON Schemas in `schemas/v1/` are a primary deliverable of this project. They define the plugin index, config, and lockfile formats.

If you modify a schema:

1. Update the schema file in `schemas/v1/`
2. Update any affected validation logic in `src/core/schema.ts`
3. Make sure existing tests still pass
4. Note the change in your PR description

## Submitting Changes

1. **Fork and branch** — create a feature branch from `master`
2. **Make your changes** — follow the conventions above
3. **Test** — run `npm test` and `npm run lint`
4. **Commit** — use conventional prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
5. **Open a PR** — describe what you changed and why

### Commit Messages

Use conventional commit prefixes:

```
feat: add version pinning to install command
fix: handle missing git binary in doctor check
docs: update plugin index spec examples
refactor: extract dependency graph into own module
test: add resolver edge case for circular deps
chore: bump vitest to 3.2
```

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update docs if the user-facing behavior changes
- If you're changing a schema, call it out explicitly

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/theokyr/venpm/issues) with:

- **Bug reports:** steps to reproduce, expected vs actual behavior, Node.js version, OS
- **Feature requests:** what you want to do and why the current behavior doesn't support it

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
