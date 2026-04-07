# venpm DX & AX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace venpm's plain Logger with a Layered Renderer architecture, add structured errors, fuzzy matching, NDJSON streaming, shell completions, branded help, and first-run experience — all following the Carbon Forest Amber brand.

**Architecture:** Commands emit semantic events through a `Renderer` interface (replaces `Logger` in `IOContext`). Four implementations — TtyRenderer (color + spinners), PlainRenderer (no ANSI), JsonRenderer (final envelope), StreamRenderer (NDJSON) — are selected at context creation time based on flags and environment. All existing ~243 tests are updated to mock `Renderer` instead of `Logger`.

**Tech Stack:** Node.js 18+, TypeScript, Commander.js, vitest. Zero new dependencies — ANSI colors, spinners, Levenshtein, and arrow-key prompts are all implemented from scratch.

**Spec:** `docs/superpowers/specs/2026-04-07-dx-ax-overhaul-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/core/ansi.ts` | ANSI 24-bit color functions (`amber`, `emerald`, `red`, `yellow`, `dim`, `bright`, `bold`), `NO_COLOR`/`FORCE_COLOR` detection |
| `src/core/fuzzy.ts` | `levenshtein()` distance, `findCandidates()` for "did you mean" suggestions |
| `src/core/errors.ts` | `ErrorInfo` type, `ErrorCode` enum, `makeError()` factory with default suggestions per code |
| `src/core/renderer.ts` | `Renderer` interface, `TtyRenderer`, `PlainRenderer` implementations |
| `src/core/json-renderer.ts` | `JsonRenderer` — collects events, writes final envelope on `finish()` |
| `src/core/stream-renderer.ts` | `StreamRenderer` — writes NDJSON line per event |
| `src/core/progress.ts` | `ProgressHandle` interface, `TtyProgress` (spinner animation), `PlainProgress` (line-based) |
| `src/cli/completions.ts` | `venpm completions bash\|zsh\|fish` command |
| `src/cli/first-run.ts` | First-run detection + guided setup flow |
| `src/cli/help.ts` | Custom branded help formatter |
| `tests/unit/ansi.test.ts` | Tests for color functions, NO_COLOR/FORCE_COLOR |
| `tests/unit/fuzzy.test.ts` | Tests for Levenshtein + candidate matching |
| `tests/unit/errors.test.ts` | Tests for error catalog, makeError |
| `tests/unit/renderer.test.ts` | Tests for TtyRenderer (no-color mode), PlainRenderer |
| `tests/unit/json-renderer.test.ts` | Tests for JsonRenderer envelope output |
| `tests/unit/stream-renderer.test.ts` | Tests for StreamRenderer NDJSON output |
| `tests/unit/progress.test.ts` | Tests for PlainProgress (TtyProgress is hard to unit test) |
| `tests/e2e/json-stream.test.ts` | E2E tests for `--json-stream` NDJSON output |
| `tests/e2e/exit-codes.test.ts` | E2E tests for exit code categories (0/1/2/3) |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/core/types.ts` | `Renderer` replaces `Logger`, add `ErrorInfo`, `StreamEvent`, `ProgressHandle`. Remove `Logger` interface. |
| `src/core/json.ts` | `jsonError()` accepts `ErrorInfo` instead of `string`. Add `warnings` to top-level envelope. |
| `src/core/prompt.ts` | Import `ansi.ts` for styled prompts. Add arrow-key `select` via raw mode. |
| `src/cli/context.ts` | Renderer selection logic. Add `--json-stream` and `--no-color` handling. |
| `src/index.ts` | Register `--json-stream`, `--no-color`, completions command. Custom help via `help.ts`. |
| `src/cli/install.ts` | Use `renderer` instead of `logger`. Structured errors. Progress for fetch/clone. |
| `src/cli/uninstall.ts` | Use `renderer`. Structured errors. |
| `src/cli/update.ts` | Use `renderer`. Structured errors. Progress. |
| `src/cli/list.ts` | Use `renderer.table()`. |
| `src/cli/search.ts` | Use `renderer.table()`. |
| `src/cli/info.ts` | Use `renderer.keyValue()`. |
| `src/cli/doctor.ts` | Use `renderer.keyValue()` with status sigils. |
| `src/cli/create.ts` | Use `renderer`. Structured errors. |
| `src/cli/rebuild.ts` | Use `renderer`. Progress for build. Structured errors. |
| `src/cli/validate.ts` | Use `renderer`. Structured errors. |
| `src/cli/repo.ts` | Use `renderer.table()`. Structured errors. |
| `src/cli/config-cmd.ts` | Use `renderer`. Fuzzy match on config keys. |
| `tests/unit/log.test.ts` | Deleted — replaced by `tests/unit/renderer.test.ts` |
| `tests/unit/json.test.ts` | Updated for `ErrorInfo` envelope |
| `tests/unit/prompt.test.ts` | Updated for styled prompt behavior |
| `tests/integration/install.test.ts` | Mock `renderer` instead of `logger` |
| `tests/integration/uninstall.test.ts` | Mock `renderer` instead of `logger` |
| `tests/integration/create.test.ts` | Mock `renderer` instead of `logger` |
| `tests/integration/json-commands.test.ts` | Updated for `ErrorInfo` envelope v2 |
| `tests/e2e/cli.test.ts` | Updated for new help format, exit codes |

### Deleted Files

| File | Reason |
|------|--------|
| `src/core/log.ts` | Fully replaced by `src/core/renderer.ts` |

---

## Task 1: ANSI Color Module

**Files:**
- Create: `src/core/ansi.ts`
- Create: `tests/unit/ansi.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/ansi.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createColors } from "../../src/core/ansi.js";

describe("createColors", () => {
    afterEach(() => {
        delete process.env.NO_COLOR;
        delete process.env.FORCE_COLOR;
    });

    it("wraps text in amber ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.amber("hello");
        expect(result).toContain("\x1b[38;2;249;115;22m");
        expect(result).toContain("hello");
        expect(result).toContain("\x1b[0m");
    });

    it("wraps text in emerald ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.emerald("ok");
        expect(result).toContain("\x1b[38;2;52;211;153m");
        expect(result).toContain("ok");
    });

    it("wraps text in red ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.red("err");
        expect(result).toContain("\x1b[38;2;239;68;68m");
    });

    it("wraps text in yellow ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.yellow("warn");
        expect(result).toContain("\x1b[38;2;251;191;36m");
    });

    it("wraps text in dim ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.dim("muted");
        expect(result).toContain("\x1b[38;2;74;92;86m");
    });

    it("wraps text in bright ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.bright("heading");
        expect(result).toContain("\x1b[38;2;232;232;232m");
    });

    it("wraps text in bold when enabled", () => {
        const c = createColors(true);
        const result = c.bold("strong");
        expect(result).toContain("\x1b[1m");
    });

    it("passes through text unchanged when disabled", () => {
        const c = createColors(false);
        expect(c.amber("hello")).toBe("hello");
        expect(c.emerald("ok")).toBe("ok");
        expect(c.red("err")).toBe("err");
        expect(c.yellow("warn")).toBe("warn");
        expect(c.dim("muted")).toBe("muted");
        expect(c.bright("heading")).toBe("heading");
        expect(c.bold("strong")).toBe("strong");
    });

    it("supports nesting: bold + amber", () => {
        const c = createColors(true);
        const result = c.bold(c.amber("hello"));
        expect(result).toContain("\x1b[1m");
        expect(result).toContain("\x1b[38;2;249;115;22m");
    });
});

describe("shouldColorize", () => {
    afterEach(() => {
        delete process.env.NO_COLOR;
        delete process.env.FORCE_COLOR;
    });

    it("returns false when NO_COLOR is set", async () => {
        process.env.NO_COLOR = "1";
        // Re-import to test the detection logic
        const { shouldColorize } = await import("../../src/core/ansi.js");
        expect(shouldColorize({ isTTY: true })).toBe(false);
    });

    it("returns true when FORCE_COLOR is set, even without TTY", async () => {
        process.env.FORCE_COLOR = "1";
        const { shouldColorize } = await import("../../src/core/ansi.js");
        expect(shouldColorize({ isTTY: false })).toBe(true);
    });

    it("returns true for TTY when no env overrides", async () => {
        const { shouldColorize } = await import("../../src/core/ansi.js");
        expect(shouldColorize({ isTTY: true })).toBe(true);
    });

    it("returns false for non-TTY when no env overrides", async () => {
        const { shouldColorize } = await import("../../src/core/ansi.js");
        expect(shouldColorize({ isTTY: false })).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ansi.test.ts`
Expected: FAIL — module `../../src/core/ansi.js` does not exist

- [ ] **Step 3: Implement the ANSI module**

```ts
// src/core/ansi.ts

function wrap(code: string): (text: string) => string {
    return (text: string) => `\x1b[${code}m${text}\x1b[0m`;
}

function passthrough(text: string): string {
    return text;
}

export interface Colors {
    amber(text: string): string;
    emerald(text: string): string;
    red(text: string): string;
    yellow(text: string): string;
    dim(text: string): string;
    bright(text: string): string;
    bold(text: string): string;
}

export function createColors(enabled: boolean): Colors {
    if (!enabled) {
        return {
            amber: passthrough,
            emerald: passthrough,
            red: passthrough,
            yellow: passthrough,
            dim: passthrough,
            bright: passthrough,
            bold: passthrough,
        };
    }
    return {
        amber: wrap("38;2;249;115;22"),
        emerald: wrap("38;2;52;211;153"),
        red: wrap("38;2;239;68;68"),
        yellow: wrap("38;2;251;191;36"),
        dim: wrap("38;2;74;92;86"),
        bright: wrap("38;2;232;232;232"),
        bold: wrap("1"),
    };
}

export function shouldColorize(stream: { isTTY?: boolean }): boolean {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return true;
    return !!stream.isTTY;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ansi.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ansi.ts tests/unit/ansi.test.ts
git commit -m "feat: add ANSI color module with Carbon Forest Amber palette"
```

---

## Task 2: Fuzzy Matching Module

**Files:**
- Create: `src/core/fuzzy.ts`
- Create: `tests/unit/fuzzy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/fuzzy.test.ts
import { describe, it, expect } from "vitest";
import { levenshtein, findCandidates } from "../../src/core/fuzzy.js";

describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
        expect(levenshtein("abc", "abc")).toBe(0);
    });

    it("returns length for empty vs non-empty", () => {
        expect(levenshtein("", "abc")).toBe(3);
        expect(levenshtein("abc", "")).toBe(3);
    });

    it("returns 1 for single substitution", () => {
        expect(levenshtein("cat", "car")).toBe(1);
    });

    it("returns 1 for single insertion", () => {
        expect(levenshtein("cat", "cats")).toBe(1);
    });

    it("returns 1 for single deletion", () => {
        expect(levenshtein("cats", "cat")).toBe(1);
    });

    it("handles transpositions", () => {
        // "BeterVolume" → "BetterVolume" = 1 insertion
        expect(levenshtein("BeterVolume", "BetterVolume")).toBe(1);
    });

    it("is case-sensitive", () => {
        expect(levenshtein("ABC", "abc")).toBe(3);
    });
});

describe("findCandidates", () => {
    const plugins = ["BetterVolume", "VolumeBooster", "CustomCSS", "BetterFolders", "NoTrack"];

    it("returns close match for typo", () => {
        const result = findCandidates("BeterVolume", plugins);
        expect(result).toContain("BetterVolume");
    });

    it("returns multiple matches when applicable", () => {
        const result = findCandidates("Better", plugins);
        // Both BetterVolume and BetterFolders should match
        expect(result).toContain("BetterVolume");
        expect(result).toContain("BetterFolders");
    });

    it("returns empty array when nothing is close", () => {
        const result = findCandidates("XXXXXXXXXXX", plugins);
        expect(result).toEqual([]);
    });

    it("returns at most 3 candidates", () => {
        const many = Array.from({ length: 20 }, (_, i) => `plugin${i}`);
        const result = findCandidates("plugin", many);
        expect(result.length).toBeLessThanOrEqual(3);
    });

    it("sorts by distance (closest first)", () => {
        const result = findCandidates("BeterVolume", plugins);
        // BetterVolume (distance 1) should come before VolumeBooster (much higher)
        if (result.length > 1) {
            expect(result[0]).toBe("BetterVolume");
        }
    });

    it("handles empty candidate list", () => {
        expect(findCandidates("anything", [])).toEqual([]);
    });

    it("handles empty input", () => {
        const result = findCandidates("", plugins);
        // Empty string has distance = candidate length, so only very short candidates might match
        // With threshold max(2, 0*0.4)=2, only candidates with length <= 2 match
        expect(result).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/fuzzy.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement the fuzzy module**

```ts
// src/core/fuzzy.ts

export function levenshtein(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost, // substitution
            );
        }
    }

    return matrix[b.length][a.length];
}

export function findCandidates(input: string, candidates: string[], maxResults = 3): string[] {
    if (candidates.length === 0 || input.length === 0) return [];

    const threshold = Math.max(2, Math.floor(input.length * 0.4));

    const scored = candidates
        .map(c => ({ name: c, distance: levenshtein(input, c) }))
        .filter(c => c.distance <= threshold)
        .sort((a, b) => a.distance - b.distance);

    return scored.slice(0, maxResults).map(c => c.name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/fuzzy.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/fuzzy.ts tests/unit/fuzzy.test.ts
git commit -m "feat: add Levenshtein fuzzy matching for 'did you mean' suggestions"
```

---

## Task 3: Error Catalog Module

**Files:**
- Create: `src/core/errors.ts`
- Create: `tests/unit/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/errors.test.ts
import { describe, it, expect } from "vitest";
import { makeError, ErrorCode, type ErrorInfo } from "../../src/core/errors.js";

describe("ErrorCode", () => {
    it("has all expected error codes", () => {
        expect(ErrorCode.VENCORD_NOT_FOUND).toBe("VENCORD_NOT_FOUND");
        expect(ErrorCode.PLUGIN_NOT_FOUND).toBe("PLUGIN_NOT_FOUND");
        expect(ErrorCode.PLUGIN_AMBIGUOUS).toBe("PLUGIN_AMBIGUOUS");
        expect(ErrorCode.PLUGIN_NOT_INSTALLED).toBe("PLUGIN_NOT_INSTALLED");
        expect(ErrorCode.REPO_FETCH_FAILED).toBe("REPO_FETCH_FAILED");
        expect(ErrorCode.GIT_NOT_AVAILABLE).toBe("GIT_NOT_AVAILABLE");
        expect(ErrorCode.PNPM_NOT_AVAILABLE).toBe("PNPM_NOT_AVAILABLE");
        expect(ErrorCode.CIRCULAR_DEPENDENCY).toBe("CIRCULAR_DEPENDENCY");
        expect(ErrorCode.VERSION_NOT_FOUND).toBe("VERSION_NOT_FOUND");
        expect(ErrorCode.SCHEMA_INVALID).toBe("SCHEMA_INVALID");
        expect(ErrorCode.BUILD_FAILED).toBe("BUILD_FAILED");
        expect(ErrorCode.DISCORD_NOT_FOUND).toBe("DISCORD_NOT_FOUND");
        expect(ErrorCode.NON_INTERACTIVE).toBe("NON_INTERACTIVE");
    });
});

describe("makeError", () => {
    it("creates ErrorInfo with default suggestion for known code", () => {
        const err = makeError(ErrorCode.VENCORD_NOT_FOUND, "Vencord path not configured");
        expect(err.code).toBe("VENCORD_NOT_FOUND");
        expect(err.message).toBe("Vencord path not configured");
        expect(err.suggestion).toBeDefined();
        expect(err.suggestion).toContain("venpm config set vencord.path");
    });

    it("allows overriding the default suggestion", () => {
        const err = makeError(ErrorCode.VENCORD_NOT_FOUND, "not found", {
            suggestion: "custom suggestion",
        });
        expect(err.suggestion).toBe("custom suggestion");
    });

    it("includes candidates when provided", () => {
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume", "VolumeBooster"],
        });
        expect(err.candidates).toEqual(["BetterVolume", "VolumeBooster"]);
        expect(err.suggestion).toContain("Did you mean");
    });

    it("includes docsUrl when provided", () => {
        const err = makeError(ErrorCode.SCHEMA_INVALID, "bad schema", {
            docsUrl: "https://venpm.dev/errors",
        });
        expect(err.docsUrl).toBe("https://venpm.dev/errors");
    });

    it("formats suggestion with candidates for single match", () => {
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume"],
        });
        expect(err.suggestion).toContain("Did you mean: BetterVolume");
    });

    it("formats suggestion with candidates for multiple matches", () => {
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume", "VolumeBooster"],
        });
        expect(err.suggestion).toContain("Did you mean one of:");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the errors module**

```ts
// src/core/errors.ts

export interface ErrorInfo {
    code: string;
    message: string;
    suggestion?: string;
    candidates?: string[];
    docsUrl?: string;
}

export const ErrorCode = {
    VENCORD_NOT_FOUND: "VENCORD_NOT_FOUND",
    PLUGIN_NOT_FOUND: "PLUGIN_NOT_FOUND",
    PLUGIN_AMBIGUOUS: "PLUGIN_AMBIGUOUS",
    PLUGIN_NOT_INSTALLED: "PLUGIN_NOT_INSTALLED",
    REPO_FETCH_FAILED: "REPO_FETCH_FAILED",
    GIT_NOT_AVAILABLE: "GIT_NOT_AVAILABLE",
    PNPM_NOT_AVAILABLE: "PNPM_NOT_AVAILABLE",
    CIRCULAR_DEPENDENCY: "CIRCULAR_DEPENDENCY",
    VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
    SCHEMA_INVALID: "SCHEMA_INVALID",
    BUILD_FAILED: "BUILD_FAILED",
    DISCORD_NOT_FOUND: "DISCORD_NOT_FOUND",
    NON_INTERACTIVE: "NON_INTERACTIVE",
} as const;

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];

const DEFAULT_SUGGESTIONS: Record<string, string> = {
    VENCORD_NOT_FOUND: "Run: venpm config set vencord.path /path/to/Vencord",
    PLUGIN_NOT_FOUND: "Run: venpm search <query> to find available plugins",
    PLUGIN_AMBIGUOUS: "Use --from <repo> to specify which repository",
    PLUGIN_NOT_INSTALLED: "Run: venpm list to see installed plugins",
    REPO_FETCH_FAILED: "Check URL with: venpm repo list",
    GIT_NOT_AVAILABLE: "Install git, or use --tarball",
    PNPM_NOT_AVAILABLE: "Install pnpm: npm i -g pnpm",
    CIRCULAR_DEPENDENCY: "Check dependency graph for cycles",
    VERSION_NOT_FOUND: "Run: venpm info <plugin> to see available versions",
    SCHEMA_INVALID: "Run: venpm validate --strict for detailed errors",
    BUILD_FAILED: "Run: venpm doctor to check your environment",
    DISCORD_NOT_FOUND: "Set: venpm config set discord.binary /path/to/discord",
    NON_INTERACTIVE: "Use --yes to auto-confirm, or set config explicitly",
};

export function makeError(
    code: ErrorCodeValue,
    message: string,
    options?: { suggestion?: string; candidates?: string[]; docsUrl?: string },
): ErrorInfo {
    let suggestion = options?.suggestion;

    if (!suggestion && options?.candidates && options.candidates.length > 0) {
        if (options.candidates.length === 1) {
            suggestion = `Did you mean: ${options.candidates[0]}`;
        } else {
            suggestion = `Did you mean one of: ${options.candidates.join(", ")}`;
        }
    }

    if (!suggestion) {
        suggestion = DEFAULT_SUGGESTIONS[code];
    }

    return {
        code,
        message,
        suggestion,
        candidates: options?.candidates,
        docsUrl: options?.docsUrl,
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/errors.ts tests/unit/errors.test.ts
git commit -m "feat: add structured error catalog with codes and suggestions"
```

---

## Task 4: Progress Handle Module

**Files:**
- Create: `src/core/progress.ts`
- Create: `tests/unit/progress.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/progress.test.ts
import { describe, it, expect, vi } from "vitest";
import { createPlainProgress } from "../../src/core/progress.js";

describe("PlainProgress", () => {
    it("prints initial message on creation", () => {
        const write = vi.fn();
        createPlainProgress("fetch-1", "Fetching index...", write);
        expect(write).toHaveBeenCalledWith("  ⟩ Fetching index...\n");
    });

    it("prints update message", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.update("Still fetching...");
        expect(write).toHaveBeenCalledWith("  ⟩ Still fetching...\n");
    });

    it("prints succeed message with checkmark", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.succeed("Done");
        expect(write).toHaveBeenCalledWith("  ✔ Done\n");
    });

    it("prints fail message with cross", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.fail("Network error");
        expect(write).toHaveBeenCalledWith("  ✖ Network error\n");
    });

    it("uses initial message if succeed called without override", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.succeed();
        expect(write).toHaveBeenCalledWith("  ✔ Fetching...\n");
    });

    it("uses initial message if fail called without override", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.fail();
        expect(write).toHaveBeenCalledWith("  ✖ Fetching...\n");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/progress.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the progress module**

```ts
// src/core/progress.ts
import type { Colors } from "./ansi.js";

export interface ProgressHandle {
    update(message: string): void;
    succeed(message?: string): void;
    fail(message?: string): void;
}

type WriteFn = (data: string) => void;

// ─── Plain (non-TTY) ─────────────────────────────────────────────────────────

export function createPlainProgress(
    _id: string,
    initialMessage: string,
    write: WriteFn,
): ProgressHandle {
    write(`  ⟩ ${initialMessage}\n`);

    return {
        update(message: string): void {
            write(`  ⟩ ${message}\n`);
        },
        succeed(message?: string): void {
            write(`  ✔ ${message ?? initialMessage}\n`);
        },
        fail(message?: string): void {
            write(`  ✖ ${message ?? initialMessage}\n`);
        },
    };
}

// ─── TTY (animated spinner) ──────────────────────────────────────────────────

const SPINNER_FRAMES = ["⟩", "⟫", "⟩"];
const SPINNER_INTERVAL = 120;

export function createTtyProgress(
    _id: string,
    initialMessage: string,
    write: WriteFn,
    colors: Colors,
): ProgressHandle {
    let message = initialMessage;
    let frameIndex = 0;
    let finished = false;

    function render(): void {
        const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
        write(`\r\x1b[K  ${colors.amber(frame)} ${message}`);
    }

    render();
    const timer = setInterval(() => {
        if (finished) return;
        frameIndex++;
        render();
    }, SPINNER_INTERVAL);

    function stop(): void {
        finished = true;
        clearInterval(timer);
    }

    return {
        update(msg: string): void {
            message = msg;
            render();
        },
        succeed(msg?: string): void {
            stop();
            write(`\r\x1b[K  ${colors.emerald("✔")} ${msg ?? message}\n`);
        },
        fail(msg?: string): void {
            stop();
            write(`\r\x1b[K  ${colors.red("✖")} ${msg ?? message}\n`);
        },
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/progress.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/progress.ts tests/unit/progress.test.ts
git commit -m "feat: add progress handles for TTY spinner and plain output"
```

---

## Task 5: Renderer Interface & Types Update

**Files:**
- Modify: `src/core/types.ts` (lines 165-186: replace `Logger` with `Renderer`)
- Create: `tests/unit/renderer.test.ts` (placeholder for now, filled in Task 6)

- [ ] **Step 1: Update types.ts — replace Logger with Renderer**

In `src/core/types.ts`, replace the `Logger` interface and its usage in `IOContext`:

Replace lines 171-177 (the `Logger` interface):
```ts
// OLD:
export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    verbose(message: string): void;
    success(message: string): void;
}

// NEW:
import type { ErrorInfo } from "./errors.js";
import type { ProgressHandle } from "./progress.js";

export interface Renderer {
    text(message: string): void;
    heading(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(info: ErrorInfo): void;
    verbose(message: string): void;
    dim(message: string): void;

    table(headers: string[], rows: string[][]): void;
    keyValue(pairs: [string, string][]): void;
    list(items: string[]): void;

    progress(id: string, message: string): ProgressHandle;

    write(data: string): void;

    /** Called when the command is done — renderers that buffer (JsonRenderer) flush here. */
    finish(success: boolean, data?: unknown, warnings?: string[]): void;
}
```

Replace `logger: Logger` with `renderer: Renderer` in the `IOContext` interface (line 185):
```ts
// OLD:
export interface IOContext {
    fs: FileSystem;
    http: HttpClient;
    git: GitClient;
    shell: ShellRunner;
    prompter: Prompter;
    logger: Logger;
}

// NEW:
export interface IOContext {
    fs: FileSystem;
    http: HttpClient;
    git: GitClient;
    shell: ShellRunner;
    prompter: Prompter;
    renderer: Renderer;
}
```

Also add `StreamEvent` type and re-export `ErrorInfo`:
```ts
export type { ErrorInfo } from "./errors.js";
export type { ProgressHandle } from "./progress.js";

export type StreamEvent =
    | { type: "progress"; id: string; message: string }
    | { type: "progress"; id: string; status: "done" | "fail"; message: string }
    | { type: "warning"; message: string; code?: string }
    | { type: "log"; message: string }
    | { type: "result"; success: true; data: unknown; warnings?: string[] }
    | { type: "error"; success: false; error: ErrorInfo };
```

- [ ] **Step 2: Run type check to see what breaks**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: MANY errors — every file that references `logger` or `Logger` will break. This is expected and confirms the scope of the change.

- [ ] **Step 3: Commit the types change**

```bash
git add src/core/types.ts
git commit -m "refactor: replace Logger with Renderer in IOContext types"
```

**Note:** The codebase will not compile until subsequent tasks update all consumers. This is expected — we commit the types first to establish the contract.

---

## Task 6: PlainRenderer & TtyRenderer Implementations

**Files:**
- Create: `src/core/renderer.ts`
- Create: `tests/unit/renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/renderer.test.ts
import { describe, it, expect, vi } from "vitest";
import { createPlainRenderer, createTtyRenderer } from "../../src/core/renderer.js";
import { createColors } from "../../src/core/ansi.js";
import { ErrorCode, makeError } from "../../src/core/errors.js";

describe("PlainRenderer", () => {
    it("writes text messages", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.text("hello");
        expect(write).toHaveBeenCalledWith("  hello\n");
    });

    it("writes heading messages", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.heading("Section");
        expect(write).toHaveBeenCalledWith("  Section\n");
    });

    it("writes success with checkmark", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.success("done");
        expect(write).toHaveBeenCalledWith("  ✔ done\n");
    });

    it("writes warning with symbol", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.warn("careful");
        expect(write).toHaveBeenCalledWith("  ⚠ careful\n");
    });

    it("writes error with code and suggestion", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "Plugin \"x\" not found");
        r.error(err);
        expect(write).toHaveBeenCalledWith(expect.stringContaining("✖ Plugin \"x\" not found"));
        expect(write).toHaveBeenCalledWith(expect.stringContaining("PLUGIN_NOT_FOUND"));
    });

    it("suppresses text and success in quiet mode", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: true }, write);
        r.text("hello");
        r.success("done");
        expect(write).not.toHaveBeenCalled();
    });

    it("always shows errors and warnings in quiet mode", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: true }, write);
        r.warn("careful");
        r.error(makeError(ErrorCode.BUILD_FAILED, "build broke"));
        expect(write).toHaveBeenCalledTimes(2);
    });

    it("shows verbose only when enabled", () => {
        const writeVerbose = vi.fn();
        const rv = createPlainRenderer({ verbose: true, quiet: false }, writeVerbose);
        rv.verbose("detail");
        expect(writeVerbose).toHaveBeenCalledWith(expect.stringContaining("detail"));

        const writeSilent = vi.fn();
        const rs = createPlainRenderer({ verbose: false, quiet: false }, writeSilent);
        rs.verbose("detail");
        expect(writeSilent).not.toHaveBeenCalled();
    });

    it("renders table with aligned columns", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.table(["Name", "Version"], [["foo", "1.0.0"], ["barbaz", "2.0.0"]]);
        const output = write.mock.calls.map(c => c[0]).join("");
        expect(output).toContain("foo");
        expect(output).toContain("barbaz");
        expect(output).toContain("1.0.0");
    });

    it("renders key-value pairs aligned", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.keyValue([["Name", "foo"], ["Version", "1.0.0"]]);
        const output = write.mock.calls.map(c => c[0]).join("");
        expect(output).toContain("Name");
        expect(output).toContain("foo");
    });

    it("renders bulleted list", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        r.list(["alpha", "beta"]);
        const output = write.mock.calls.map(c => c[0]).join("");
        expect(output).toContain("alpha");
        expect(output).toContain("beta");
    });

    it("creates plain progress handles", () => {
        const write = vi.fn();
        const r = createPlainRenderer({ verbose: false, quiet: false }, write);
        const handle = r.progress("p1", "Working...");
        handle.succeed("Done");
        expect(write).toHaveBeenCalledWith(expect.stringContaining("Working..."));
        expect(write).toHaveBeenCalledWith(expect.stringContaining("✔ Done"));
    });
});

describe("TtyRenderer (with colors disabled for testing)", () => {
    it("applies amber to headings", () => {
        const write = vi.fn();
        const colors = createColors(true);
        const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
        r.heading("Section");
        const output = write.mock.calls[0][0];
        // Should contain amber ANSI code
        expect(output).toContain("\x1b[38;2;249;115;22m");
        expect(output).toContain("Section");
    });

    it("applies emerald to success", () => {
        const write = vi.fn();
        const colors = createColors(true);
        const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
        r.success("done");
        const output = write.mock.calls[0][0];
        expect(output).toContain("\x1b[38;2;52;211;153m");
    });

    it("applies red to error message", () => {
        const write = vi.fn();
        const colors = createColors(true);
        const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
        r.error(makeError(ErrorCode.BUILD_FAILED, "build broke"));
        const output = write.mock.calls.map(c => c[0]).join("");
        expect(output).toContain("\x1b[38;2;239;68;68m");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/renderer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement renderer.ts**

```ts
// src/core/renderer.ts
import type { Renderer } from "./types.js";
import type { ErrorInfo } from "./errors.js";
import type { Colors } from "./ansi.js";
import { createColors } from "./ansi.js";
import { createPlainProgress, createTtyProgress, type ProgressHandle } from "./progress.js";

type WriteFn = (data: string) => void;

interface RendererOptions {
    verbose: boolean;
    quiet: boolean;
}

// ─── Table Formatting ────────────────────────────────────────────────────────

function formatTable(headers: string[], rows: string[][]): string {
    const colWidths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)),
    );
    const lines: string[] = [];
    lines.push("  " + headers.map((h, i) => h.padEnd(colWidths[i])).join("  "));
    for (const row of rows) {
        lines.push("  " + row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  "));
    }
    return lines.join("\n") + "\n";
}

function formatKeyValue(pairs: [string, string][]): string {
    const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
    return pairs.map(([k, v]) => `  ${k.padEnd(maxKeyLen)}  ${v}`).join("\n") + "\n";
}

function formatError(err: ErrorInfo): string {
    const lines: string[] = [];
    lines.push(`  ✖ ${err.message}`);
    if (err.suggestion) {
        lines.push(`  ⟩ ${err.suggestion}`);
    }
    lines.push(`${"".padStart(50)}[${err.code}]`);
    return lines.join("\n") + "\n";
}

function formatErrorColored(err: ErrorInfo, colors: Colors): string {
    const lines: string[] = [];
    lines.push(`  ${colors.red("✖")} ${err.message}`);
    if (err.suggestion) {
        lines.push(`  ${colors.amber("⟩")} ${err.suggestion}`);
    }
    lines.push(`${"".padStart(50)}${colors.dim(`[${err.code}]`)}`);
    return lines.join("\n") + "\n";
}

// ─── PlainRenderer ───────────────────────────────────────────────────────────

export function createPlainRenderer(
    options: RendererOptions,
    write: WriteFn = (s) => process.stdout.write(s),
): Renderer {
    const { verbose, quiet } = options;

    return {
        text(message: string): void {
            if (!quiet) write(`  ${message}\n`);
        },
        heading(message: string): void {
            if (!quiet) write(`  ${message}\n`);
        },
        success(message: string): void {
            if (!quiet) write(`  ✔ ${message}\n`);
        },
        warn(message: string): void {
            write(`  ⚠ ${message}\n`);
        },
        error(info: ErrorInfo): void {
            write(formatError(info));
        },
        verbose(message: string): void {
            if (verbose) write(`  ${message}\n`);
        },
        dim(message: string): void {
            if (!quiet) write(`  ${message}\n`);
        },
        table(headers: string[], rows: string[][]): void {
            if (!quiet) write(formatTable(headers, rows));
        },
        keyValue(pairs: [string, string][]): void {
            if (!quiet) write(formatKeyValue(pairs));
        },
        list(items: string[]): void {
            if (!quiet) write(items.map(item => `    ${item}`).join("\n") + "\n");
        },
        progress(id: string, message: string): ProgressHandle {
            return createPlainProgress(id, message, write);
        },
        write(data: string): void {
            write(data);
        },
        finish(): void {
            // No-op for plain renderer — output is already written
        },
    };
}

// ─── TtyRenderer ─────────────────────────────────────────────────────────────

export function createTtyRenderer(
    options: RendererOptions,
    write: WriteFn = (s) => process.stdout.write(s),
    colors?: Colors,
): Renderer {
    const { verbose, quiet } = options;
    const c = colors ?? createColors(true);

    return {
        text(message: string): void {
            if (!quiet) write(`  ${message}\n`);
        },
        heading(message: string): void {
            if (!quiet) write(`  ${c.bold(c.amber(message))}\n`);
        },
        success(message: string): void {
            if (!quiet) write(`  ${c.emerald("✔")} ${message}\n`);
        },
        warn(message: string): void {
            write(`  ${c.yellow("⚠")} ${message}\n`);
        },
        error(info: ErrorInfo): void {
            write(formatErrorColored(info, c));
        },
        verbose(message: string): void {
            if (verbose) write(`  ${c.dim(message)}\n`);
        },
        dim(message: string): void {
            if (!quiet) write(`  ${c.dim(message)}\n`);
        },
        table(headers: string[], rows: string[][]): void {
            if (quiet) return;
            const colWidths = headers.map((h, i) =>
                Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)),
            );
            write("  " + headers.map((h, i) => c.dim(h.padEnd(colWidths[i]))).join("  ") + "\n");
            for (const row of rows) {
                write("  " + row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  ") + "\n");
            }
        },
        keyValue(pairs: [string, string][]): void {
            if (quiet) return;
            const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
            for (const [k, v] of pairs) {
                write(`  ${c.dim(k.padEnd(maxKeyLen))}  ${v}\n`);
            }
        },
        list(items: string[]): void {
            if (!quiet) write(items.map(item => `    ${item}`).join("\n") + "\n");
        },
        progress(id: string, message: string): ProgressHandle {
            return createTtyProgress(id, message, write, c);
        },
        write(data: string): void {
            write(data);
        },
        finish(): void {
            // No-op for TTY renderer — output is already written
        },
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/renderer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/renderer.ts tests/unit/renderer.test.ts
git commit -m "feat: add PlainRenderer and TtyRenderer implementations"
```

---

## Task 7: JsonRenderer Implementation

**Files:**
- Create: `src/core/json-renderer.ts`
- Create: `tests/unit/json-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/json-renderer.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJsonRenderer } from "../../src/core/json-renderer.js";
import { ErrorCode, makeError } from "../../src/core/errors.js";

describe("JsonRenderer", () => {
    it("collects warnings and outputs them in final envelope", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        r.warn("something odd");
        r.warn("another warning");
        r.finish(true, { installed: [] });
        expect(write).toHaveBeenCalledTimes(1);
        const envelope = JSON.parse(write.mock.calls[0][0]);
        expect(envelope.success).toBe(true);
        expect(envelope.data).toEqual({ installed: [] });
        expect(envelope.warnings).toEqual(["something odd", "another warning"]);
    });

    it("outputs error envelope on finish with error", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume"],
        });
        r.error(err);
        r.finish(false);
        const envelope = JSON.parse(write.mock.calls[0][0]);
        expect(envelope.success).toBe(false);
        expect(envelope.error.code).toBe("PLUGIN_NOT_FOUND");
        expect(envelope.error.candidates).toEqual(["BetterVolume"]);
    });

    it("silently ignores text, heading, success, verbose, dim calls", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        r.text("ignored");
        r.heading("ignored");
        r.success("ignored");
        r.verbose("ignored");
        r.dim("ignored");
        expect(write).not.toHaveBeenCalled();
    });

    it("silently ignores table, keyValue, list calls", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        r.table([], []);
        r.keyValue([]);
        r.list([]);
        expect(write).not.toHaveBeenCalled();
    });

    it("progress handles are no-ops", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        const handle = r.progress("p1", "working");
        handle.update("still working");
        handle.succeed("done");
        expect(write).not.toHaveBeenCalled();
    });

    it("outputs envelope with trailing newline", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        r.finish(true, { result: "ok" });
        expect(write.mock.calls[0][0]).toMatch(/\n$/);
    });

    it("outputs valid JSON", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        r.finish(true, { name: "test" });
        expect(() => JSON.parse(write.mock.calls[0][0])).not.toThrow();
    });

    it("omits warnings key when no warnings", () => {
        const write = vi.fn();
        const r = createJsonRenderer(write);
        r.finish(true, { ok: true });
        const envelope = JSON.parse(write.mock.calls[0][0]);
        expect(envelope.warnings).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/json-renderer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement JsonRenderer**

```ts
// src/core/json-renderer.ts
import type { Renderer } from "./types.js";
import type { ErrorInfo } from "./errors.js";
import type { ProgressHandle } from "./progress.js";

type WriteFn = (data: string) => void;

const NOOP_PROGRESS: ProgressHandle = {
    update(): void {},
    succeed(): void {},
    fail(): void {},
};

export function createJsonRenderer(
    write: WriteFn = (s) => process.stdout.write(s),
): Renderer {
    const warnings: string[] = [];
    let lastError: ErrorInfo | undefined;

    return {
        text(): void {},
        heading(): void {},
        success(): void {},
        warn(message: string): void {
            warnings.push(message);
        },
        error(info: ErrorInfo): void {
            lastError = info;
        },
        verbose(): void {},
        dim(): void {},
        table(): void {},
        keyValue(): void {},
        list(): void {},
        progress(): ProgressHandle {
            return NOOP_PROGRESS;
        },
        write(): void {},
        finish(success: boolean, data?: unknown, extraWarnings?: string[]): void {
            const allWarnings = [...warnings, ...(extraWarnings ?? [])];
            if (success) {
                const envelope: Record<string, unknown> = { success: true, data };
                if (allWarnings.length > 0) {
                    envelope.warnings = allWarnings;
                }
                write(JSON.stringify(envelope) + "\n");
            } else {
                const envelope: Record<string, unknown> = {
                    success: false,
                    error: lastError ?? { code: "UNKNOWN", message: "Unknown error" },
                };
                if (allWarnings.length > 0) {
                    envelope.warnings = allWarnings;
                }
                write(JSON.stringify(envelope) + "\n");
            }
        },
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/json-renderer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/json-renderer.ts tests/unit/json-renderer.test.ts
git commit -m "feat: add JsonRenderer for --json envelope v2 output"
```

---

## Task 8: StreamRenderer Implementation

**Files:**
- Create: `src/core/stream-renderer.ts`
- Create: `tests/unit/stream-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/stream-renderer.test.ts
import { describe, it, expect, vi } from "vitest";
import { createStreamRenderer } from "../../src/core/stream-renderer.js";
import { ErrorCode, makeError } from "../../src/core/errors.js";

function parseLines(write: ReturnType<typeof vi.fn>): unknown[] {
    return write.mock.calls.map((c: [string]) => JSON.parse(c[0]));
}

describe("StreamRenderer", () => {
    it("emits warning events", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        r.warn("something odd");
        const events = parseLines(write);
        expect(events).toEqual([{ type: "warning", message: "something odd" }]);
    });

    it("emits log events for text calls", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        r.text("hello");
        const events = parseLines(write);
        expect(events).toEqual([{ type: "log", message: "hello" }]);
    });

    it("emits progress events", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        const handle = r.progress("fetch-1", "Fetching...");
        handle.update("Still going");
        handle.succeed("Done");
        const events = parseLines(write);
        expect(events[0]).toEqual({ type: "progress", id: "fetch-1", message: "Fetching..." });
        expect(events[1]).toEqual({ type: "progress", id: "fetch-1", message: "Still going" });
        expect(events[2]).toEqual({ type: "progress", id: "fetch-1", status: "done", message: "Done" });
    });

    it("emits fail status for progress", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        const handle = r.progress("p1", "Working...");
        handle.fail("Broke");
        const events = parseLines(write);
        expect(events[1]).toEqual({ type: "progress", id: "p1", status: "fail", message: "Broke" });
    });

    it("emits result event on finish(true)", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        r.warn("w1");
        r.finish(true, { installed: ["foo"] }, ["w2"]);
        const events = parseLines(write);
        // Last event should be result
        const last = events[events.length - 1] as Record<string, unknown>;
        expect(last.type).toBe("result");
        expect(last.success).toBe(true);
        expect(last.data).toEqual({ installed: ["foo"] });
        expect(last.warnings).toEqual(["w1", "w2"]);
    });

    it("emits error event on finish(false)", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        const err = makeError(ErrorCode.BUILD_FAILED, "build broke");
        r.error(err);
        r.finish(false);
        const events = parseLines(write);
        const last = events[events.length - 1] as Record<string, unknown>;
        expect(last.type).toBe("error");
        expect(last.success).toBe(false);
        expect((last.error as Record<string, unknown>).code).toBe("BUILD_FAILED");
    });

    it("outputs valid NDJSON (one JSON object per line)", () => {
        const write = vi.fn();
        const r = createStreamRenderer(write);
        r.text("hello");
        r.warn("careful");
        r.finish(true, {});
        for (const call of write.mock.calls) {
            const line = call[0] as string;
            expect(line).toMatch(/\n$/);
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/stream-renderer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement StreamRenderer**

```ts
// src/core/stream-renderer.ts
import type { Renderer } from "./types.js";
import type { ErrorInfo } from "./errors.js";
import type { ProgressHandle } from "./progress.js";

type WriteFn = (data: string) => void;

function emit(write: WriteFn, event: Record<string, unknown>): void {
    write(JSON.stringify(event) + "\n");
}

export function createStreamRenderer(
    write: WriteFn = (s) => process.stdout.write(s),
): Renderer {
    const warnings: string[] = [];
    let lastError: ErrorInfo | undefined;

    return {
        text(message: string): void {
            emit(write, { type: "log", message });
        },
        heading(message: string): void {
            emit(write, { type: "log", message });
        },
        success(message: string): void {
            emit(write, { type: "log", message });
        },
        warn(message: string): void {
            warnings.push(message);
            emit(write, { type: "warning", message });
        },
        error(info: ErrorInfo): void {
            lastError = info;
        },
        verbose(message: string): void {
            emit(write, { type: "log", message });
        },
        dim(message: string): void {
            emit(write, { type: "log", message });
        },
        table(): void {},
        keyValue(): void {},
        list(): void {},
        progress(id: string, message: string): ProgressHandle {
            emit(write, { type: "progress", id, message });
            return {
                update(msg: string): void {
                    emit(write, { type: "progress", id, message: msg });
                },
                succeed(msg?: string): void {
                    emit(write, { type: "progress", id, status: "done", message: msg ?? message });
                },
                fail(msg?: string): void {
                    emit(write, { type: "progress", id, status: "fail", message: msg ?? message });
                },
            };
        },
        write(data: string): void {
            emit(write, { type: "log", message: data });
        },
        finish(success: boolean, data?: unknown, extraWarnings?: string[]): void {
            const allWarnings = [...warnings, ...(extraWarnings ?? [])];
            if (success) {
                const event: Record<string, unknown> = {
                    type: "result",
                    success: true,
                    data,
                };
                if (allWarnings.length > 0) event.warnings = allWarnings;
                emit(write, event);
            } else {
                const event: Record<string, unknown> = {
                    type: "error",
                    success: false,
                    error: lastError ?? { code: "UNKNOWN", message: "Unknown error" },
                };
                if (allWarnings.length > 0) event.warnings = allWarnings;
                emit(write, event);
            }
        },
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/stream-renderer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/stream-renderer.ts tests/unit/stream-renderer.test.ts
git commit -m "feat: add StreamRenderer for --json-stream NDJSON output"
```

---

## Task 9: Update json.ts for Envelope v2

**Files:**
- Modify: `src/core/json.ts`
- Modify: `tests/unit/json.test.ts`

- [ ] **Step 1: Update tests for new envelope shape**

Replace `tests/unit/json.test.ts`:

```ts
// tests/unit/json.test.ts
import { describe, it, expect, vi } from "vitest";
import { jsonSuccess, jsonError, writeJson } from "../../src/core/json.js";
import type { ErrorInfo } from "../../src/core/errors.js";

describe("jsonSuccess", () => {
    it("wraps data in success envelope", () => {
        const result = jsonSuccess({ plugins: [] });
        expect(result).toEqual({ success: true, data: { plugins: [] } });
    });

    it("handles null data", () => {
        const result = jsonSuccess(null);
        expect(result).toEqual({ success: true, data: null });
    });

    it("includes warnings when provided", () => {
        const result = jsonSuccess({ ok: true }, ["warning 1"]);
        expect(result).toEqual({ success: true, data: { ok: true }, warnings: ["warning 1"] });
    });

    it("omits warnings when empty array provided", () => {
        const result = jsonSuccess({ ok: true }, []);
        expect(result.warnings).toBeUndefined();
    });
});

describe("jsonError", () => {
    it("wraps ErrorInfo in error envelope", () => {
        const err: ErrorInfo = { code: "PLUGIN_NOT_FOUND", message: "not found" };
        const result = jsonError(err);
        expect(result).toEqual({ success: false, error: err });
    });

    it("preserves all ErrorInfo fields", () => {
        const err: ErrorInfo = {
            code: "PLUGIN_NOT_FOUND",
            message: "not found",
            suggestion: "try this",
            candidates: ["foo"],
            docsUrl: "https://venpm.dev",
        };
        const result = jsonError(err);
        expect(result.error).toEqual(err);
    });
});

describe("writeJson", () => {
    it("writes JSON to stdout", () => {
        const write = vi.fn();
        writeJson({ success: true, data: {} }, write);
        const output = JSON.parse(write.mock.calls[0][0]);
        expect(output.success).toBe(true);
    });

    it("outputs valid JSON with trailing newline", () => {
        const err: ErrorInfo = { code: "TEST", message: "fail" };
        const write = vi.fn();
        writeJson({ success: false, error: err }, write);
        const raw = write.mock.calls[0][0];
        expect(() => JSON.parse(raw)).not.toThrow();
        expect(raw.endsWith("\n")).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/json.test.ts`
Expected: FAIL — `jsonError` still accepts `string`

- [ ] **Step 3: Update json.ts**

```ts
// src/core/json.ts
import type { ErrorInfo } from "./errors.js";

export interface JsonEnvelope<T = unknown> {
    success: boolean;
    error?: ErrorInfo;
    data?: T;
    warnings?: string[];
}

export function jsonSuccess<T>(data: T, warnings?: string[]): JsonEnvelope<T> {
    const envelope: JsonEnvelope<T> = { success: true, data };
    if (warnings && warnings.length > 0) {
        envelope.warnings = warnings;
    }
    return envelope;
}

export function jsonError(error: ErrorInfo): JsonEnvelope<never> {
    return { success: false, error };
}

export function writeJson(envelope: JsonEnvelope, write: (s: string) => void = s => process.stdout.write(s)): void {
    write(JSON.stringify(envelope) + "\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/json.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/json.ts tests/unit/json.test.ts
git commit -m "refactor: upgrade JSON envelope to v2 with ErrorInfo and top-level warnings"
```

---

## Task 10: Delete log.ts, Update Context & CLI Entry Point

**Files:**
- Delete: `src/core/log.ts`
- Delete: `tests/unit/log.test.ts`
- Modify: `src/cli/context.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Delete log.ts and its test**

```bash
rm src/core/log.ts tests/unit/log.test.ts
```

- [ ] **Step 2: Update context.ts with renderer selection**

Replace `src/cli/context.ts` — this is the core wiring that selects the right renderer:

```ts
// src/cli/context.ts
import { execFile as _execFile, spawn as _spawn } from "node:child_process";
import { promisify } from "node:util";
import * as fsPromises from "node:fs/promises";
import { createPrompter } from "../core/prompt.js";
import { shouldColorize, createColors } from "../core/ansi.js";
import { createPlainRenderer, createTtyRenderer } from "../core/renderer.js";
import { createJsonRenderer } from "../core/json-renderer.js";
import { createStreamRenderer } from "../core/stream-renderer.js";
import type { IOContext, FileSystem, HttpClient, GitClient, ShellRunner, GlobalOptions } from "../core/types.js";

const execFileAsync = promisify(_execFile);

export function createRealIOContext(options: GlobalOptions): IOContext {
    const fs: FileSystem = {
        async readFile(path: string, encoding: BufferEncoding): Promise<string> {
            return fsPromises.readFile(path, { encoding });
        },
        async writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void> {
            return fsPromises.writeFile(path, data, { encoding: encoding ?? "utf8" });
        },
        async exists(path: string): Promise<boolean> {
            try {
                await fsPromises.access(path);
                return true;
            } catch {
                return false;
            }
        },
        async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
            await fsPromises.mkdir(path, opts);
        },
        async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
            await fsPromises.rm(path, opts);
        },
        async symlink(target: string, path: string): Promise<void> {
            return fsPromises.symlink(target, path);
        },
        async readlink(path: string): Promise<string> {
            return fsPromises.readlink(path);
        },
        async readdir(path: string): Promise<string[]> {
            return fsPromises.readdir(path);
        },
        async stat(path: string) {
            return fsPromises.stat(path);
        },
        async lstat(path: string) {
            return fsPromises.lstat(path);
        },
        async copyDir(src: string, dest: string): Promise<void> {
            await fsPromises.cp(src, dest, { recursive: true });
        },
    };

    const http: HttpClient = {
        async fetch(url: string, fetchOptions?: { headers?: Record<string, string> }) {
            const res = await globalThis.fetch(url, { headers: fetchOptions?.headers });
            return {
                ok: res.ok,
                status: res.status,
                headers: res.headers,
                text: () => res.text(),
                json: () => res.json() as Promise<unknown>,
                arrayBuffer: () => res.arrayBuffer(),
            };
        },
    };

    const git: GitClient = {
        async available(): Promise<boolean> {
            try {
                await execFileAsync("git", ["--version"]);
                return true;
            } catch {
                return false;
            }
        },
        async clone(url: string, dest: string, cloneOptions?: { sparse?: string[]; branch?: string; depth?: number }): Promise<void> {
            const args = ["clone", "--filter=blob:none"];
            if (cloneOptions?.sparse && cloneOptions.sparse.length > 0) {
                args.push("--sparse");
            }
            if (cloneOptions?.branch) {
                args.push("--branch", cloneOptions.branch);
            }
            if (cloneOptions?.depth !== undefined) {
                args.push("--depth", String(cloneOptions.depth));
            }
            args.push(url, dest);
            await execFileAsync("git", args);
            if (cloneOptions?.sparse && cloneOptions.sparse.length > 0) {
                await execFileAsync("git", ["-C", dest, "sparse-checkout", "set", ...cloneOptions.sparse]);
            }
        },
        async pull(repoPath: string): Promise<void> {
            await execFileAsync("git", ["-C", repoPath, "pull"]);
        },
        async revParse(repoPath: string, ref: string): Promise<string> {
            const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", ref]);
            return stdout.trim();
        },
        async checkout(repoPath: string, ref: string): Promise<void> {
            await execFileAsync("git", ["-C", repoPath, "checkout", ref]);
        },
    };

    const shell: ShellRunner = {
        async exec(cmd: string, args: string[], execOptions?: { cwd?: string; env?: Record<string, string> }) {
            try {
                const { stdout, stderr } = await execFileAsync(cmd, args, {
                    cwd: execOptions?.cwd,
                    env: execOptions?.env ? { ...process.env, ...execOptions.env } : undefined,
                });
                return { stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 };
            } catch (err: unknown) {
                const e = err as { stdout?: string; stderr?: string; code?: number };
                return {
                    stdout: e.stdout ?? "",
                    stderr: e.stderr ?? "",
                    exitCode: e.code ?? 1,
                };
            }
        },
        async spawn(cmd: string, args: string[], spawnOptions?: { cwd?: string; detached?: boolean; env?: Record<string, string> }): Promise<void> {
            return new Promise((resolve, reject) => {
                const child = _spawn(cmd, args, {
                    cwd: spawnOptions?.cwd,
                    detached: spawnOptions?.detached,
                    env: spawnOptions?.env ? { ...process.env, ...spawnOptions.env } : undefined,
                    stdio: "ignore",
                });
                if (spawnOptions?.detached) {
                    child.unref();
                    resolve();
                } else {
                    child.on("close", (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`${cmd} exited with code ${code}`));
                    });
                    child.on("error", reject);
                }
            });
        },
    };

    // ── Renderer selection ────────────────────────────────────────────────
    const jsonStream = !!(options as Record<string, unknown>).jsonStream;
    const isJson = !!options.json;

    let renderer;
    if (jsonStream) {
        renderer = createStreamRenderer();
    } else if (isJson) {
        renderer = createJsonRenderer();
    } else {
        const colorEnabled = shouldColorize(process.stdout);
        if (colorEnabled) {
            const colors = createColors(true);
            renderer = createTtyRenderer(
                { verbose: options.verbose ?? false, quiet: options.quiet ?? false },
                (s) => process.stdout.write(s),
                colors,
            );
        } else {
            renderer = createPlainRenderer(
                { verbose: options.verbose ?? false, quiet: options.quiet ?? false },
            );
        }
    }

    // ── Prompter ──────────────────────────────────────────────────────────
    const nonInteractive = !process.stdin.isTTY && !options.yes && !isJson && !jsonStream;
    const prompter = createPrompter({
        yes: options.yes || isJson || jsonStream || false,
        nonInteractive,
    });

    return { fs, http, git, shell, prompter, renderer };
}
```

- [ ] **Step 3: Update index.ts with new flags**

In `src/index.ts`, add `--json-stream` and `--no-color` options, and update `GlobalOptions` in types.ts:

First add `jsonStream?: boolean` to `GlobalOptions` in `src/core/types.ts`:
```ts
export interface GlobalOptions {
    config?: string;
    verbose?: boolean;
    quiet?: boolean;
    yes?: boolean;
    json?: boolean;
    jsonStream?: boolean;
}
```

Then update `src/index.ts`:
```ts
program
    .name("venpm")
    .description("Vencord Plugin Manager — install and manage userplugins")
    .version(version)
    .option("-y, --yes", "Automatically answer yes to all prompts")
    .option("--verbose", "Enable verbose output")
    .option("--quiet", "Suppress non-essential output")
    .option("--json", "Output structured JSON instead of human-readable text")
    .option("--json-stream", "Output events as NDJSON")
    .option("--no-color", "Disable colored output");
```

- [ ] **Step 4: Verify the project compiles (it won't yet — CLI commands still reference logger)**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: Many errors from CLI commands referencing `ctx.logger` — this is expected and will be fixed in Task 11.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: wire renderer selection into context, delete log.ts, add --json-stream flag"
```

---

## Task 11: Migrate All CLI Commands from Logger to Renderer

This is the largest task — systematically update every CLI command file to use `ctx.renderer` instead of `ctx.logger`, use structured errors, and call `renderer.finish()` for JSON/stream output.

**Files:**
- Modify: `src/cli/install.ts`
- Modify: `src/cli/uninstall.ts`
- Modify: `src/cli/update.ts`
- Modify: `src/cli/list.ts`
- Modify: `src/cli/search.ts`
- Modify: `src/cli/info.ts`
- Modify: `src/cli/doctor.ts`
- Modify: `src/cli/create.ts`
- Modify: `src/cli/rebuild.ts`
- Modify: `src/cli/validate.ts`
- Modify: `src/cli/repo.ts`
- Modify: `src/cli/config-cmd.ts`

The migration pattern for each file is the same:
1. Replace `ctx.logger` with `ctx.renderer` (or destructure as `const { renderer } = ctx`)
2. Replace `logger.info(msg)` → `renderer.text(msg)`
3. Replace `logger.success(msg)` → `renderer.success(msg)`
4. Replace `logger.warn(msg)` → `renderer.warn(msg)`
5. Replace `logger.error(msg)` → `renderer.error(makeError(CODE, msg))` with appropriate error code
6. Replace `logger.verbose(msg)` → `renderer.verbose(msg)`
7. Remove all `if (options.json) { writeJson(...); return; }` blocks — the renderer handles output mode
8. Add `renderer.finish(true, data, warnings)` at successful exits
9. Add `renderer.finish(false)` at error exits (after `renderer.error(...)`)
10. Add fuzzy matching where applicable (install, info, uninstall, update — call `findCandidates()`)
11. Use `renderer.progress()` for long operations
12. Use `renderer.table()` and `renderer.keyValue()` for structured display

- [ ] **Step 1: Migrate list.ts (simplest command — validate the pattern)**

```ts
// src/cli/list.ts
import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadLockfile } from "../core/lockfile.js";
import { getLockfilePath } from "../core/paths.js";
import { createRealIOContext } from "./context.js";

export async function executeList(ctx: IOContext, options: GlobalOptions = {}): Promise<void> {
    const lockfile = await loadLockfile(ctx.fs, getLockfilePath());
    const installed = Object.entries(lockfile.installed);

    if (installed.length === 0) {
        ctx.renderer.text("No plugins installed");
        ctx.renderer.finish(true, { plugins: [] });
        return;
    }

    ctx.renderer.heading(`Installed plugins (${installed.length}):`);

    const rows = installed.map(([name, info]) => {
        const flags = [
            info.pinned ? "pinned" : "",
            info.method === "local" ? "local" : "",
        ].filter(Boolean).join(", ");
        return [name, info.version, info.method, info.repo, flags];
    });

    ctx.renderer.table(["Name", "Version", "Method", "Repo", "Flags"], rows);

    ctx.renderer.finish(true, {
        plugins: installed.map(([name, info]) => ({
            name,
            version: info.version,
            repo: info.repo,
            method: info.method,
            pinned: info.pinned,
        })),
    });
}

export function registerListCommand(program: Command): void {
    program
        .command("list")
        .description("List installed plugins")
        .action(async () => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            await executeList(ctx, globalOpts);
        });
}
```

- [ ] **Step 2: Migrate search.ts**

```ts
// src/cli/search.ts
import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { fetchAllIndexes, searchPlugins } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { createRealIOContext } from "./context.js";

export async function executeSearch(ctx: IOContext, query: string, options: GlobalOptions = {}): Promise<void> {
    const config = await loadConfig(ctx.fs, options.config ?? getConfigPath());
    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);

    for (const fi of indexes) {
        if (fi.error) {
            ctx.renderer.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const results = searchPlugins(indexes, query);

    if (results.length === 0) {
        ctx.renderer.text(`No plugins found matching "${query}"`);
        ctx.renderer.finish(true, { results: [] });
        return;
    }

    ctx.renderer.heading(`Search results for "${query}" (${results.length} found):`);

    const rows = results.map(match => [
        match.name,
        match.entry.version,
        match.entry.description ?? "",
        match.repoName,
    ]);
    ctx.renderer.table(["Name", "Version", "Description", "Repo"], rows);

    ctx.renderer.finish(true, {
        results: results.map(r => ({
            name: r.name,
            version: r.entry.version,
            description: r.entry.description ?? null,
            repo: r.repoName,
        })),
    });
}

export function registerSearchCommand(program: Command): void {
    program
        .command("search <query>")
        .description("Search for plugins in configured repositories")
        .action(async (query: string) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            await executeSearch(ctx, query, globalOpts);
        });
}
```

- [ ] **Step 3: Migrate info.ts**

```ts
// src/cli/info.ts
import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, getInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin, searchPlugins } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { ErrorCode, makeError } from "../core/errors.js";
import { findCandidates } from "../core/fuzzy.js";
import { createRealIOContext } from "./context.js";

export async function executeInfo(ctx: IOContext, pluginName: string, options: GlobalOptions = {}): Promise<void> {
    const configPath = options.config ?? getConfigPath();
    const [config, lockfile] = await Promise.all([
        loadConfig(ctx.fs, configPath),
        loadLockfile(ctx.fs, getLockfilePath()),
    ]);

    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);

    for (const fi of indexes) {
        if (fi.error) {
            ctx.renderer.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const match = resolvePlugin(indexes, pluginName);
    const installedInfo = getInstalled(lockfile, pluginName);

    if (!match && !installedInfo) {
        // Fuzzy match
        const allPluginNames = indexes
            .filter(fi => fi.index)
            .flatMap(fi => Object.keys(fi.index!.plugins));
        const candidates = findCandidates(pluginName, allPluginNames);

        ctx.renderer.error(makeError(
            ErrorCode.PLUGIN_NOT_FOUND,
            `Plugin "${pluginName}" not found in any index and is not installed`,
            { candidates },
        ));
        process.exitCode = 1;
        ctx.renderer.finish(false);
        return;
    }

    const data = {
        name: pluginName,
        version: match?.entry.version ?? null,
        description: match?.entry.description ?? null,
        authors: match?.entry.authors ?? [],
        repo: match?.repoName ?? null,
        dependencies: match?.entry.dependencies ?? [],
        optionalDependencies: match?.entry.optionalDependencies ?? [],
        versions: match?.entry.versions ? Object.keys(match.entry.versions) : [],
        installed: !!installedInfo,
        installedVersion: installedInfo?.version ?? null,
    };

    ctx.renderer.heading(`Plugin: ${pluginName}`);

    if (match) {
        const { entry, repoName } = match;
        const pairs: [string, string][] = [
            ["Repository", repoName],
            ["Version", entry.version],
        ];
        if (entry.description) pairs.push(["Description", entry.description]);
        if (entry.authors?.length) pairs.push(["Authors", entry.authors.map(a => a.name).join(", ")]);
        if (entry.license) pairs.push(["License", entry.license]);
        if (entry.dependencies?.length) pairs.push(["Depends on", entry.dependencies.join(", ")]);
        if (entry.discord) pairs.push(["Discord", entry.discord]);
        if (entry.vencord) pairs.push(["Vencord", entry.vencord]);
        const sourceKeys = Object.keys(entry.source).filter(k => entry.source[k as keyof typeof entry.source]);
        pairs.push(["Source", sourceKeys.join(", ")]);
        if (entry.versions) pairs.push(["Versions", Object.keys(entry.versions).join(", ")]);

        ctx.renderer.keyValue(pairs);
    } else {
        ctx.renderer.warn("Plugin not found in any currently reachable index");
    }

    if (installedInfo) {
        ctx.renderer.heading("Installed:");
        ctx.renderer.keyValue([
            ["Version", installedInfo.version],
            ["Method", installedInfo.method],
            ["Pinned", installedInfo.pinned ? "yes" : "no"],
            ["Installed at", installedInfo.installed_at],
            ...(installedInfo.git_ref ? [["Git ref", installedInfo.git_ref] as [string, string]] : []),
        ]);
    } else {
        ctx.renderer.dim("Not installed.");
    }

    ctx.renderer.finish(true, data);
}

export function registerInfoCommand(program: Command): void {
    program
        .command("info <plugin>")
        .description("Show details about a plugin")
        .action(async (plugin: string) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            await executeInfo(ctx, plugin, globalOpts);
        });
}
```

- [ ] **Step 4: Migrate install.ts, uninstall.ts, update.ts**

Apply the same pattern: replace `logger` with `renderer`, use `makeError()` for errors, add `renderer.progress()` for fetch/clone operations, call `renderer.finish()` at exit points. Add fuzzy matching for `PLUGIN_NOT_FOUND` errors using `findCandidates()`.

For `install.ts`, key changes:
- Wrap index fetching in `renderer.progress("fetch-indexes", "Fetching indexes...")`
- Wrap each `fetchPlugin()` call in `renderer.progress()`
- Replace all `writeJson()` calls — renderer handles it via `finish()`
- Add `findCandidates()` when plugin not found

For `uninstall.ts`:
- Add `findCandidates()` from lockfile names when plugin not installed
- Use `ErrorCode.PLUGIN_NOT_INSTALLED`

For `update.ts`:
- Add progress for each plugin update
- Use `ErrorCode.PLUGIN_NOT_INSTALLED` with fuzzy matching

- [ ] **Step 5: Migrate doctor.ts, rebuild.ts, validate.ts, repo.ts, config-cmd.ts, create.ts**

Apply the same pattern. Key notes:
- `doctor.ts`: Use `renderer.keyValue()` for the status display
- `rebuild.ts`: Use `renderer.progress()` for the build, `ErrorCode.VENCORD_NOT_FOUND`, `ErrorCode.BUILD_FAILED`
- `validate.ts`: Use `ErrorCode.SCHEMA_INVALID`
- `repo.ts`: Use `renderer.table()` for repo list
- `config-cmd.ts`: Add `findCandidates()` on valid config keys when key not found
- `create.ts`: Use `renderer` instead of `logger`

- [ ] **Step 6: Verify project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: migrate all CLI commands from Logger to Renderer"
```

---

## Task 12: Update All Existing Tests

**Files:**
- Modify: `tests/integration/install.test.ts`
- Modify: `tests/integration/uninstall.test.ts`
- Modify: `tests/integration/create.test.ts`
- Modify: `tests/integration/json-commands.test.ts`
- Modify: `tests/e2e/cli.test.ts`
- Modify: `tests/unit/types.test.ts` (if it references Logger)

The pattern is the same across all test files:

1. Replace `Logger` import with `Renderer` import
2. Replace mock logger objects with mock renderer objects:

```ts
// OLD:
const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    success: vi.fn(),
};

// NEW:
const renderer: Renderer = {
    text: vi.fn(),
    heading: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    dim: vi.fn(),
    table: vi.fn(),
    keyValue: vi.fn(),
    list: vi.fn(),
    progress: vi.fn(() => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
    write: vi.fn(),
    finish: vi.fn(),
};
```

3. Replace `ctx.logger` → `ctx.renderer` in context factories
4. Update assertions: `logger.error` was called with a string → `renderer.error` is called with an `ErrorInfo` object
5. In `json-commands.test.ts`: instead of capturing stdout, check `renderer.finish()` calls — OR keep the stdout capture approach since JsonRenderer writes to stdout. The simpler approach is to keep stdout capture and update the envelope assertions from `env.error` being a string to `env.error` being an `ErrorInfo` object.

- [ ] **Step 1: Create a shared mock renderer helper**

Create a helper function that all test files can use. Add it at the top of each test file (or in a shared test helper):

```ts
function createMockRenderer() {
    return {
        text: vi.fn(),
        heading: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        verbose: vi.fn(),
        dim: vi.fn(),
        table: vi.fn(),
        keyValue: vi.fn(),
        list: vi.fn(),
        progress: vi.fn(() => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
        write: vi.fn(),
        finish: vi.fn(),
    };
}
```

- [ ] **Step 2: Update integration/install.test.ts**

Replace all `Logger` references with `Renderer`. Update the `createMockContext` function to return `renderer` instead of `logger`. Update all assertions that check `logger.error` to check `renderer.error`.

- [ ] **Step 3: Update integration/uninstall.test.ts**

Same pattern — replace `logger` with `renderer` in `makeCtx()`.

- [ ] **Step 4: Update integration/create.test.ts**

Same pattern — replace `logger` with `renderer` in `makeCtx()`.

- [ ] **Step 5: Update integration/json-commands.test.ts**

This file captures stdout directly. Update the `env.error` assertions:
```ts
// OLD:
expect(env.error).toContain("not found");

// NEW:
expect(env.error.message).toContain("not found");
expect(env.error.code).toBeDefined();
```

Also update the mock context to use `renderer` instead of `logger`.

- [ ] **Step 6: Update e2e/cli.test.ts**

E2E tests run the compiled CLI. Minimal changes needed — just verify the output still contains expected strings. The help test may need updating if the help format changes (Task 14).

- [ ] **Step 7: Update tests/unit/types.test.ts if it references Logger**

Check if this file references `Logger` and update if needed.

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: update all tests from Logger mocks to Renderer mocks"
```

---

## Task 13: Styled Prompts

**Files:**
- Modify: `src/core/prompt.ts`
- Modify: `tests/unit/prompt.test.ts`

- [ ] **Step 1: Update prompt tests**

Add tests for the styled prompt behaviors. The non-interactive and `--yes` tests remain the same. Add a test verifying the select prompt interface still works:

```ts
// Add to tests/unit/prompt.test.ts

describe("createStyledPrompter (yes=true)", () => {
    // Import the new function name if it changes, or keep createPrompter
    const prompter = createPrompter({ yes: true });

    it("auto-confirms with yes=true", async () => {
        expect(await prompter.confirm("Continue?")).toBe(true);
    });

    it("auto-returns default for input with yes=true", async () => {
        expect(await prompter.input("Name?", "Alice")).toBe("Alice");
    });

    it("auto-selects first choice with yes=true", async () => {
        const choices = [
            { value: "a", label: "Option A" },
            { value: "b", label: "Option B" },
        ];
        expect(await prompter.select("Pick one:", choices)).toBe("a");
    });
});
```

- [ ] **Step 2: Run tests to verify they pass (no behavior change for yes/nonInteractive)**

Run: `npx vitest run tests/unit/prompt.test.ts`
Expected: PASS — the `--yes` and non-interactive paths don't change

- [ ] **Step 3: Update prompt.ts with ANSI styling for TTY prompts**

Update the TTY branch of `createPrompter` to use amber `?` prefix and styled output. The arrow-key select is implemented via raw mode `process.stdin.setRawMode(true)`:

In `src/core/prompt.ts`, import from ansi.ts and update the TTY prompt rendering. The key changes:
- `confirm`: prefix with amber `?`, dim hint
- `input`: prefix with amber `?`, dim default hint
- `select`: arrow-key navigation with amber `❯` marker, fallback to numbered input if raw mode unavailable

The `--yes` and `nonInteractive` branches remain unchanged.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/prompt.ts tests/unit/prompt.test.ts
git commit -m "feat: add styled prompts with amber accents and arrow-key select"
```

---

## Task 14: Custom Help Formatter

**Files:**
- Create: `src/cli/help.ts`
- Modify: `src/index.ts`
- Modify: `tests/e2e/cli.test.ts`

- [ ] **Step 1: Write the help formatter**

```ts
// src/cli/help.ts
import type { Command } from "commander";
import { shouldColorize, createColors } from "../core/ansi.js";

export function configureHelp(program: Command): void {
    const colorEnabled = shouldColorize(process.stdout);
    const c = createColors(colorEnabled);

    program.configureHelp({
        formatHelp(cmd, helper) {
            const lines: string[] = [];

            lines.push(`  ${c.bold("venpm")} ${c.dim("— Vencord Plugin Manager")}`);
            lines.push("");

            lines.push(`  ${c.bright("USAGE")}`);
            lines.push(`    venpm <command> [options]`);
            lines.push("");

            // Commands
            const commands = cmd.commands.filter(c => !c._hidden);
            if (commands.length > 0) {
                lines.push(`  ${c.bright("COMMANDS")}`);
                const maxLen = Math.max(...commands.map(c => c.name().length + (c.usage() ? c.usage().length + 1 : 0)));
                for (const sub of commands) {
                    const name = sub.usage() ? `${sub.name()} ${sub.usage()}` : sub.name();
                    lines.push(`    ${c.amber(name.padEnd(maxLen + 2))} ${c.dim(sub.description() ?? "")}`);
                }
                lines.push("");
            }

            // Options
            const opts = cmd.options;
            if (opts.length > 0) {
                lines.push(`  ${c.bright("OPTIONS")}`);
                const maxOptLen = Math.max(...opts.map(o => o.flags.length));
                for (const opt of opts) {
                    lines.push(`    ${opt.flags.padEnd(maxOptLen + 2)} ${c.dim(opt.description)}`);
                }
                lines.push("");
            }

            lines.push(`  ${c.dim("DOCS")}  ${c.amber("https://venpm.dev")}`);
            lines.push("");

            return lines.join("\n");
        },
    });
}
```

- [ ] **Step 2: Wire help into index.ts**

In `src/index.ts`, after creating the program, call `configureHelp(program)`:

```ts
import { configureHelp } from "./cli/help.js";
// ... after program definition
configureHelp(program);
```

- [ ] **Step 3: Update E2E help test**

```ts
// In tests/e2e/cli.test.ts, update the help test:
it("--help shows branded output with venpm and DOCS footer", async () => {
    const xdg = await makeTmp();
    const env = makeEnv(xdg, VENCORD_FIXTURE);
    const { stdout, code } = await run(["--help"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("venpm");
    expect(stdout).toContain("COMMANDS");
    expect(stdout).toContain("install");
    expect(stdout).toContain("venpm.dev");
});
```

- [ ] **Step 4: Build and run E2E test**

Run: `npm run build && npx vitest run tests/e2e/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/help.ts src/index.ts tests/e2e/cli.test.ts
git commit -m "feat: add branded help formatter with Carbon Forest Amber styling"
```

---

## Task 15: Shell Completions Command

**Files:**
- Create: `src/cli/completions.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Implement completions command**

```ts
// src/cli/completions.ts
import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { createRealIOContext } from "./context.js";

const BASH_COMPLETION = `
_venpm_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local commands="install uninstall update list search info repo config create rebuild doctor validate completions"
    if [ "\${COMP_CWORD}" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
}
complete -F _venpm_completions venpm
`.trim();

const ZSH_COMPLETION = `
#compdef venpm
_venpm() {
    local -a commands
    commands=(
        'install:Install a plugin and its dependencies'
        'uninstall:Remove a plugin'
        'update:Update one or all plugins'
        'list:List installed plugins'
        'search:Search available plugins'
        'info:Show plugin details'
        'repo:Manage plugin repositories'
        'config:View or edit configuration'
        'create:Scaffold a new plugin or repo'
        'rebuild:Rebuild Vencord'
        'doctor:Check environment health'
        'validate:Validate a plugin index'
        'completions:Output shell completion script'
    )
    _describe 'command' commands
}
_venpm
`.trim();

const FISH_COMPLETION = `
complete -c venpm -n "__fish_use_subcommand" -a install -d "Install a plugin"
complete -c venpm -n "__fish_use_subcommand" -a uninstall -d "Remove a plugin"
complete -c venpm -n "__fish_use_subcommand" -a update -d "Update plugins"
complete -c venpm -n "__fish_use_subcommand" -a list -d "List installed plugins"
complete -c venpm -n "__fish_use_subcommand" -a search -d "Search plugins"
complete -c venpm -n "__fish_use_subcommand" -a info -d "Show plugin details"
complete -c venpm -n "__fish_use_subcommand" -a repo -d "Manage repositories"
complete -c venpm -n "__fish_use_subcommand" -a config -d "View/edit configuration"
complete -c venpm -n "__fish_use_subcommand" -a create -d "Scaffold plugin or repo"
complete -c venpm -n "__fish_use_subcommand" -a rebuild -d "Rebuild Vencord"
complete -c venpm -n "__fish_use_subcommand" -a doctor -d "Check environment"
complete -c venpm -n "__fish_use_subcommand" -a validate -d "Validate plugin index"
complete -c venpm -n "__fish_use_subcommand" -a completions -d "Output completion script"
`.trim();

export function registerCompletionsCommand(program: Command): void {
    program
        .command("completions [shell]")
        .description("Output shell completion script (bash, zsh, fish)")
        .action((shell?: string) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);

            const target = shell ?? detectShell();
            switch (target) {
                case "bash":
                    ctx.renderer.write(BASH_COMPLETION + "\n");
                    break;
                case "zsh":
                    ctx.renderer.write(ZSH_COMPLETION + "\n");
                    break;
                case "fish":
                    ctx.renderer.write(FISH_COMPLETION + "\n");
                    break;
                default:
                    ctx.renderer.text(`Unknown shell: ${target}. Supported: bash, zsh, fish`);
                    ctx.renderer.text("Usage: eval \"$(venpm completions zsh)\"");
                    process.exitCode = 1;
            }
        });
}

function detectShell(): string {
    const shell = process.env.SHELL ?? "";
    if (shell.includes("zsh")) return "zsh";
    if (shell.includes("fish")) return "fish";
    return "bash";
}
```

- [ ] **Step 2: Register in index.ts**

```ts
import { registerCompletionsCommand } from "./cli/completions.js";
// ... after other registrations
registerCompletionsCommand(program);
```

- [ ] **Step 3: Build and test manually**

Run: `npm run build && node dist/index.js completions bash`
Expected: Outputs bash completion script

- [ ] **Step 4: Commit**

```bash
git add src/cli/completions.ts src/index.ts
git commit -m "feat: add shell completions command for bash, zsh, and fish"
```

---

## Task 16: First-Run Experience

**Files:**
- Create: `src/cli/first-run.ts`
- Modify: `src/index.ts` (hook first-run before command execution)

- [ ] **Step 1: Implement first-run detection and setup**

```ts
// src/cli/first-run.ts
import type { IOContext } from "../core/types.js";
import { getConfigPath } from "../core/paths.js";
import { saveConfig, DEFAULT_CONFIG } from "../core/config.js";
import { detectVencordPath } from "../core/detect.js";
import { ErrorCode, makeError } from "../core/errors.js";

const COMMANDS_NEEDING_CONFIG = new Set([
    "install", "uninstall", "update", "list", "search", "info",
    "repo", "rebuild", "doctor",
]);

export function needsFirstRun(commandName: string): boolean {
    return COMMANDS_NEEDING_CONFIG.has(commandName);
}

export async function runFirstTimeSetup(ctx: IOContext, version: string): Promise<boolean> {
    const configPath = getConfigPath();
    const configExists = await ctx.fs.exists(configPath);

    if (configExists) return false; // Not first run

    // Non-interactive: error out
    try {
        ctx.renderer.heading(`venpm v${version}`);
        ctx.renderer.text("");
        ctx.renderer.text("First time? Let's set up.");
        ctx.renderer.text("");

        // Detect Vencord path
        const detected = await detectVencordPath(ctx.fs);
        let vencordPath: string;
        if (detected) {
            const useDetected = await ctx.prompter.confirm(
                `Vencord source path: ${detected}`,
                true,
            );
            if (useDetected) {
                vencordPath = detected;
            } else {
                vencordPath = await ctx.prompter.input("Vencord source path:");
            }
        } else {
            vencordPath = await ctx.prompter.input("Vencord source path:");
        }

        // Ask about community repo
        const addCommunity = await ctx.prompter.confirm(
            "Add the community plugin repo?",
            true,
        );

        // Build config
        const config = { ...DEFAULT_CONFIG };
        config.vencord.path = vencordPath || null;
        if (addCommunity) {
            // DEFAULT_CONFIG already has the kamaras repo
        } else {
            config.repos = [];
        }

        await saveConfig(ctx.fs, configPath, config);
        ctx.renderer.success(`Config saved to ${configPath}`);
        ctx.renderer.text("");
        ctx.renderer.text("Run venpm search to browse available plugins.");
        return true;
    } catch {
        // Prompter threw (non-interactive) — let the command handle it
        return false;
    }
}
```

- [ ] **Step 2: Hook first-run into index.ts**

Add a `preAction` hook on the program:

```ts
import { needsFirstRun, runFirstTimeSetup } from "./cli/first-run.js";

// After configureHelp(program), before program.parse():
program.hook("preAction", async (thisCommand) => {
    const commandName = thisCommand.args[0] ?? thisCommand.name();
    if (needsFirstRun(commandName)) {
        const globalOpts = program.opts<GlobalOptions>();
        const ctx = createRealIOContext(globalOpts);
        await runFirstTimeSetup(ctx, version);
    }
});
```

- [ ] **Step 3: Build and test with empty config dir**

Run: `npm run build && XDG_CONFIG_HOME=/tmp/venpm-first-run-test node dist/index.js doctor`
Expected: First-run prompt appears, then doctor runs

- [ ] **Step 4: Commit**

```bash
git add src/cli/first-run.ts src/index.ts
git commit -m "feat: add first-run setup experience for new users"
```

---

## Task 17: Exit Code Categories

**Files:**
- Modify: All CLI command files that set `process.exitCode`
- Create: `tests/e2e/exit-codes.test.ts`

- [ ] **Step 1: Define exit code constants**

Add to `src/core/errors.ts`:

```ts
export const ExitCode = {
    SUCCESS: 0,
    COMMAND_ERROR: 1,   // Plugin not found, validation failed
    USAGE_ERROR: 2,     // Bad arguments
    ENV_ERROR: 3,       // Git missing, Vencord not found, build failed
} as const;

export function exitCodeForError(code: ErrorCodeValue): number {
    switch (code) {
        case ErrorCode.VENCORD_NOT_FOUND:
        case ErrorCode.GIT_NOT_AVAILABLE:
        case ErrorCode.PNPM_NOT_AVAILABLE:
        case ErrorCode.BUILD_FAILED:
        case ErrorCode.DISCORD_NOT_FOUND:
            return ExitCode.ENV_ERROR;
        default:
            return ExitCode.COMMAND_ERROR;
    }
}
```

- [ ] **Step 2: Update CLI commands to use exitCodeForError()**

In each command that sets `process.exitCode = 1`, change to:

```ts
process.exitCode = exitCodeForError(ErrorCode.PLUGIN_NOT_FOUND);
```

- [ ] **Step 3: Write E2E exit code tests**

```ts
// tests/e2e/exit-codes.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = join(import.meta.dirname, "..", "..", "dist", "index.js");
const VENCORD_FIXTURE = join(import.meta.dirname, "..", "fixtures", "vencord");

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number }> {
    try {
        await execFileAsync("node", [CLI, ...args], { env });
        return { code: 0 };
    } catch (err: unknown) {
        return { code: (err as { code?: number }).code ?? 1 };
    }
}

describe("exit codes", () => {
    const tmpDirs: string[] = [];
    async function makeTmp() {
        const dir = await mkdtemp(join(tmpdir(), "venpm-exit-"));
        tmpDirs.push(dir);
        return dir;
    }
    afterEach(async () => {
        for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    });

    it("exits 0 for successful commands", async () => {
        const xdg = await makeTmp();
        const env = { ...process.env, XDG_CONFIG_HOME: xdg, VENPM_VENCORD_PATH: VENCORD_FIXTURE };
        const { code } = await run(["list", "--json"], env);
        expect(code).toBe(0);
    });

    it("exits 1 for command errors (plugin not found)", async () => {
        const xdg = await makeTmp();
        const env = { ...process.env, XDG_CONFIG_HOME: xdg, VENPM_VENCORD_PATH: VENCORD_FIXTURE };
        const { code } = await run(["info", "nonexistent-plugin", "--json"], env);
        expect(code).toBe(1);
    });
});
```

- [ ] **Step 4: Build and run exit code tests**

Run: `npm run build && npx vitest run tests/e2e/exit-codes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/errors.ts src/cli/*.ts tests/e2e/exit-codes.test.ts
git commit -m "feat: add categorized exit codes (0=success, 1=command, 2=usage, 3=env)"
```

---

## Task 18: E2E Tests for --json-stream

**Files:**
- Create: `tests/e2e/json-stream.test.ts`

- [ ] **Step 1: Write NDJSON E2E tests**

```ts
// tests/e2e/json-stream.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = join(import.meta.dirname, "..", "..", "dist", "index.js");
const VENCORD_FIXTURE = join(import.meta.dirname, "..", "fixtures", "vencord");

function makeEnv(xdg: string): NodeJS.ProcessEnv {
    return { ...process.env, XDG_CONFIG_HOME: xdg, VENPM_VENCORD_PATH: VENCORD_FIXTURE };
}

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; code: number }> {
    try {
        const { stdout } = await execFileAsync("node", [CLI, ...args], { env });
        return { stdout, code: 0 };
    } catch (err: unknown) {
        const e = err as { stdout?: string; code?: number };
        return { stdout: e.stdout ?? "", code: e.code ?? 1 };
    }
}

function parseNdjson(stdout: string): unknown[] {
    return stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

describe("--json-stream", () => {
    const tmpDirs: string[] = [];
    async function makeTmp() {
        const dir = await mkdtemp(join(tmpdir(), "venpm-stream-"));
        tmpDirs.push(dir);
        return dir;
    }
    afterEach(async () => {
        for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    });

    it("list outputs NDJSON ending with result event", async () => {
        const xdg = await makeTmp();
        const { stdout, code } = await run(["list", "--json-stream"], makeEnv(xdg));
        expect(code).toBe(0);
        const events = parseNdjson(stdout);
        const last = events[events.length - 1] as Record<string, unknown>;
        expect(last.type).toBe("result");
        expect(last.success).toBe(true);
    });

    it("each line is valid JSON", async () => {
        const xdg = await makeTmp();
        const { stdout } = await run(["doctor", "--json-stream"], makeEnv(xdg));
        const lines = stdout.trim().split("\n").filter(Boolean);
        for (const line of lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });

    it("info for nonexistent plugin ends with error event", async () => {
        const xdg = await makeTmp();
        const { stdout } = await run(["info", "nonexistent", "--json-stream"], makeEnv(xdg));
        const events = parseNdjson(stdout);
        const last = events[events.length - 1] as Record<string, unknown>;
        expect(last.type).toBe("error");
        expect(last.success).toBe(false);
        expect((last.error as Record<string, unknown>).code).toBeDefined();
    });
});
```

- [ ] **Step 2: Build and run**

Run: `npm run build && npx vitest run tests/e2e/json-stream.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/json-stream.test.ts
git commit -m "test: add E2E tests for --json-stream NDJSON output"
```

---

## Task 19: Full Test Suite Verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass (original ~243 + new tests)

- [ ] **Step 2: Run type check**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Manual smoke test**

Run a few commands to verify the visual output:
```bash
node dist/index.js --help
node dist/index.js doctor
node dist/index.js list
node dist/index.js list --json
node dist/index.js list --json-stream
node dist/index.js info nonexistent-plugin
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve any issues found during full verification"
```

---

## Task 20: Update venpm CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Architecture section**

Add new modules to the file listing:
```
src/core/
  ansi.ts          # ANSI 24-bit color functions (Carbon Forest Amber palette)
  fuzzy.ts         # Levenshtein distance for "did you mean" suggestions
  errors.ts        # ErrorInfo type, ErrorCode enum, makeError() factory
  renderer.ts      # Renderer interface + TtyRenderer, PlainRenderer
  json-renderer.ts # JsonRenderer for --json envelope v2
  stream-renderer.ts # StreamRenderer for --json-stream NDJSON
  progress.ts      # ProgressHandle for TTY spinners and plain output
```

- [ ] **Step 2: Update IOContext Pattern section**

Replace Logger description with Renderer:
```
- `renderer` — output (text, heading, success, warn, error, table, keyValue, progress); mode selected at context creation:
  - TTY + color → TtyRenderer (amber/emerald/red ANSI)
  - TTY no color / pipe / CI → PlainRenderer (no ANSI)
  - `--json` → JsonRenderer (final envelope)
  - `--json-stream` → StreamRenderer (NDJSON per event)
```

- [ ] **Step 3: Update Non-Interactive Mode section**

Add `--json-stream` alongside `--json`:
```
### Non-Interactive Mode

When stdin is not a TTY, prompts throw errors with instructions to use `--yes` or set config explicitly. Both `--json` and `--json-stream` imply `--yes`.

Exit codes: 0=success, 1=command error, 2=usage error, 3=environment error.
```

- [ ] **Step 4: Add Error Codes section**

Add the full error catalog table from the spec.

- [ ] **Step 5: Update Testing section**

Add renderer mocking pattern:
```
### Writing Tests

- Mock `Renderer` with vi.fn() for all methods (see createMockRenderer helper in test files)
- Integration tests use `renderer.finish()` to verify output data
- E2E tests verify exit codes, --json envelope v2, and --json-stream NDJSON format
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Renderer architecture and error codes"
```

---

## Task 21: Update venpm-docs (venpm.dev)

**Files:**
- Modify: `/home/theo/src/venpm-docs/` (separate repo)

This task operates in the `venpm-docs` repository. The implementer should:

- [ ] **Step 1: Update CLI reference page**

Add `--json-stream`, `--no-color`, and `venpm completions` documentation.

- [ ] **Step 2: Update or create JSON API page**

Document the v2 envelope shape:
```json
{
  "success": true,
  "data": { ... },
  "warnings": ["..."]
}
```

Document NDJSON event types for `--json-stream`.

Add migration note from v1 (error was a string, now an ErrorInfo object).

- [ ] **Step 3: Create Error Codes reference page**

Table of all error codes, descriptions, and default suggestions.

- [ ] **Step 4: Update DESIGN.md with CLI section**

Add terminal color mapping (brand → ANSI), the `⟩` sigil, and output patterns to DESIGN.md.

- [ ] **Step 5: Commit in venpm-docs repo**

```bash
cd ~/src/venpm-docs
git add -A
git commit -m "docs: add CLI color system, error codes, and JSON v2 API reference"
```

---

## Task 22: Update Agent Skills

**Files:**
- Modify: Skills in `~/src/agents/` repository

- [ ] **Step 1: Update venpm-ecosystem skill**

Add documentation about:
- `--json-stream` flag for agentic use (preferred over `--json` for progress visibility)
- Exit code semantics (0/1/2/3)
- Error code parsing pattern: `envelope.error.code` for switching on error type

- [ ] **Step 2: Review venpm-scrub and venpm-deploy skills**

Check if any new files need exclusion or if deploy workflow is affected.

- [ ] **Step 3: Commit in agents repo**

```bash
cd ~/src/agents
git add -A
git commit -m "docs: update venpm skills with Renderer, --json-stream, and error codes"
```

---

## Task 23: Version Bump

**Files:**
- Modify: `package.json`

This is a breaking change to the JSON envelope (error field changes from `string` to `ErrorInfo`). Bump to `0.2.0`.

- [ ] **Step 1: Update package.json version**

In `package.json`, change `"version": "0.1.1"` to `"version": "0.2.0"`.

- [ ] **Step 2: Run build and tests**

Run: `npm run build && npm test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.2.0 for Renderer architecture and JSON envelope v2"
```

- [ ] **Step 4: Tag for release (when ready)**

```bash
git tag v0.2.0
```

Note: Do NOT push the tag until the user explicitly approves. The `v*` tag triggers npm publish via CI.

---

## Task Summary

| # | Task | Est. Complexity |
|---|------|----------------|
| 1 | ANSI Color Module | Small — leaf module, no deps |
| 2 | Fuzzy Matching Module | Small — leaf module, no deps |
| 3 | Error Catalog Module | Small — leaf module, no deps |
| 4 | Progress Handle Module | Small — depends on ansi.ts |
| 5 | Renderer Types Update | Small — types only, breaks compilation |
| 6 | PlainRenderer & TtyRenderer | Medium — core implementations |
| 7 | JsonRenderer | Small — simple collector |
| 8 | StreamRenderer | Small — simple emitter |
| 9 | json.ts Envelope v2 | Small — update existing |
| 10 | Delete log.ts, Update Context | Medium — wiring |
| 11 | Migrate All CLI Commands | Large — 12 files, same pattern |
| 12 | Update All Existing Tests | Large — ~243 tests, same pattern |
| 13 | Styled Prompts | Medium — TTY raw mode |
| 14 | Custom Help Formatter | Small — new file |
| 15 | Shell Completions | Small — new file |
| 16 | First-Run Experience | Small — new file |
| 17 | Exit Code Categories | Small — update existing |
| 18 | E2E Tests for --json-stream | Small — new tests |
| 19 | Full Verification | Small — run tests |
| 20 | Update venpm CLAUDE.md | Small — docs |
| 21 | Update venpm-docs | Medium — separate repo |
| 22 | Update Agent Skills | Small — separate repo |
| 23 | Version Bump to 0.2.0 | Small — package.json + tag |

Tasks 1-4 are independent leaf modules and can be parallelized.
Tasks 5-10 must be sequential (types → implementations → wiring).
Tasks 11-12 can be partially parallelized (different files).
Tasks 13-18 are independent features.
Task 19 is the verification gate.
Tasks 20-22 are documentation and can be parallelized.
