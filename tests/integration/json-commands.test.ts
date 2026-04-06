import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
    IOContext,
    FileSystem,
    HttpClient,
    GitClient,
    ShellRunner,
    Prompter,
    Logger,
    LockfileData,
    Config,
    GlobalOptions,
    InstallOptions,
} from "../../src/core/types.js";
import type { JsonEnvelope } from "../../src/core/json.js";
import { executeList } from "../../src/cli/list.js";
import { executeSearch } from "../../src/cli/search.js";
import { executeInfo } from "../../src/cli/info.js";
import { executeUninstall } from "../../src/cli/uninstall.js";
import { executeInstall } from "../../src/cli/install.js";
import { executeUpdate } from "../../src/cli/update.js";

// Mock tar and node fs/promises
vi.mock("tar", () => ({
    extract: vi.fn(async () => {}),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        writeFile: vi.fn(async () => {}),
        unlink: vi.fn(async () => {}),
    };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_INDEX = {
    name: "test-repo",
    description: "Test repository",
    plugins: {
        testPlugin: {
            version: "1.0.0",
            description: "A test plugin",
            authors: [{ name: "kamaras", id: "111222333" }],
            source: { git: "https://example.com/testPlugin.git" },
        },
    },
};

const MOCK_CONFIG: Config = {
    repos: [{ name: "test-repo", url: "https://example.com/plugins.json" }],
    vencord: { path: "/home/user/Vencord" },
    rebuild: "never",
    discord: { restart: "never", binary: null },
};

/** Capture JSON written to stdout by writeJson */
function captureStdout(): { captured: string[]; restore: () => void } {
    const captured: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
        captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
    }) as any;
    return {
        captured,
        restore: () => { process.stdout.write = original; },
    };
}

function parseEnvelope(captured: string[]): JsonEnvelope {
    expect(captured.length).toBeGreaterThan(0);
    return JSON.parse(captured[0]);
}

function createMockContext(overrides?: {
    lockfile?: LockfileData;
}): IOContext {
    const lockfileData: LockfileData = overrides?.lockfile ?? { installed: {} };

    const fs: FileSystem = {
        readFile: vi.fn().mockImplementation(async (path: string) => {
            if (path.includes("config.json")) return JSON.stringify(MOCK_CONFIG);
            if (path.includes("venpm-lock.json")) return JSON.stringify(lockfileData);
            if (path.includes("cache.json")) return JSON.stringify({});
            return "";
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockImplementation(async (path: string) => {
            if (path.includes("config.json") || path.includes("venpm-lock.json")) return true;
            if (path.includes("/home/user/Vencord")) return true;
            return false;
        }),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockResolvedValue(undefined),
        symlink: vi.fn().mockResolvedValue(undefined),
        readlink: vi.fn().mockResolvedValue(""),
        readdir: vi.fn().mockResolvedValue([]),
        stat: vi.fn().mockResolvedValue({ isDirectory: () => true, isFile: () => false, size: 0 }),
        lstat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }),
        copyDir: vi.fn().mockResolvedValue(undefined),
    } as any;

    const http: HttpClient = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
            if (url.includes("plugins.json")) {
                return {
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    text: vi.fn().mockResolvedValue(JSON.stringify(MOCK_INDEX)),
                    json: vi.fn().mockResolvedValue(MOCK_INDEX),
                    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
                };
            }
            return { ok: false, status: 404, text: async () => "", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
        }),
    } as any;

    const git: GitClient = {
        available: vi.fn().mockResolvedValue(true),
        clone: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        revParse: vi.fn().mockResolvedValue("abc123"),
        checkout: vi.fn().mockResolvedValue(undefined),
    } as any;

    const shell: ShellRunner = {
        exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
        spawn: vi.fn().mockResolvedValue(undefined),
    } as any;

    const prompter: Prompter = {
        confirm: vi.fn().mockResolvedValue(true),
        input: vi.fn().mockResolvedValue(""),
        select: vi.fn().mockResolvedValue(""),
    } as any;

    const logger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        verbose: vi.fn(),
        success: vi.fn(),
    };

    return { fs, http, git, shell, prompter, logger };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("--json output", () => {
    let ctx: IOContext;
    let stdout: ReturnType<typeof captureStdout>;

    beforeEach(() => {
        ctx = createMockContext();
        stdout = captureStdout();
    });

    afterEach(() => {
        stdout.restore();
    });

    it("list outputs valid JSON envelope with empty plugins", async () => {
        await executeList(ctx, { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect(env.data).toEqual({ plugins: [] });
    });

    it("list outputs plugins when installed", async () => {
        ctx = createMockContext({
            lockfile: {
                installed: {
                    testPlugin: {
                        version: "1.0.0",
                        repo: "test-repo",
                        method: "git",
                        pinned: false,
                        installed_at: "2026-01-01",
                    },
                },
            },
        });
        await executeList(ctx, { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect((env.data as any).plugins).toHaveLength(1);
        expect((env.data as any).plugins[0].name).toBe("testPlugin");
    });

    it("search outputs valid JSON with results", async () => {
        await executeSearch(ctx, "test", { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect((env.data as any).results).toBeDefined();
        expect(Array.isArray((env.data as any).results)).toBe(true);
    });

    it("info outputs valid JSON for known plugin", async () => {
        await executeInfo(ctx, "testPlugin", { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect((env.data as any).name).toBe("testPlugin");
        expect((env.data as any).version).toBe("1.0.0");
    });

    it("info outputs JSON error for unknown plugin", async () => {
        await executeInfo(ctx, "nonExistentPlugin", { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(false);
        expect(env.error).toContain("not found");
    });

    it("uninstall outputs JSON error for not-installed plugin", async () => {
        await executeUninstall(ctx, "nonExistentPlugin", { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(false);
        expect(env.error).toContain("not installed");
    });

    it("uninstall outputs JSON success when plugin removed", async () => {
        ctx = createMockContext({
            lockfile: {
                installed: {
                    testPlugin: {
                        version: "1.0.0",
                        repo: "test-repo",
                        method: "git",
                        pinned: false,
                        installed_at: "2026-01-01",
                    },
                },
            },
        });
        await executeUninstall(ctx, "testPlugin", { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect((env.data as any).removed).toBe("testPlugin");
    });

    it("install outputs JSON error for not-found plugin", async () => {
        const options: InstallOptions = { json: true };
        await executeInstall(ctx, "nonExistentPlugin", options);
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(false);
        expect(env.error).toContain("not found");
    });

    it("install outputs JSON success with installed array", async () => {
        const options: InstallOptions = { json: true, noBuild: true };
        await executeInstall(ctx, "testPlugin", options);
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect((env.data as any).installed).toBeDefined();
        expect(Array.isArray((env.data as any).installed)).toBe(true);
    });

    it("update outputs JSON with empty updated array when nothing installed", async () => {
        await executeUpdate(ctx, undefined, { json: true });
        expect(stdout.captured.length).toBe(1);
        const output = JSON.parse(stdout.captured[0]);
        expect(output.success).toBe(true);
        expect(output.data.updated).toEqual([]);
        expect(output.data.skipped).toEqual([]);
    });

    it("update outputs JSON with updated/skipped for installed plugins", async () => {
        ctx = createMockContext({
            lockfile: {
                installed: {
                    testPlugin: {
                        version: "0.9.0", // older than 1.0.0 in index
                        repo: "test-repo",
                        method: "git",
                        pinned: false,
                        installed_at: "2026-01-01",
                    },
                },
            },
        });
        await executeUpdate(ctx, "testPlugin", { json: true });
        const env = parseEnvelope(stdout.captured);
        expect(env.success).toBe(true);
        expect((env.data as any).updated).toBeDefined();
    });
});

// Need afterEach imported
import { afterEach } from "vitest";
