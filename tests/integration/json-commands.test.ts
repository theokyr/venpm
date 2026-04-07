import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
    IOContext,
    FileSystem,
    HttpClient,
    GitClient,
    ShellRunner,
    Prompter,
    Renderer,
    LockfileData,
    Config,
    GlobalOptions,
    InstallOptions,
} from "../../src/core/types.js";
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

function createMockContext(overrides?: {
    lockfile?: LockfileData;
}): IOContext & { renderer: Renderer & Record<string, ReturnType<typeof vi.fn>> } {
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

    const renderer: Renderer & Record<string, ReturnType<typeof vi.fn>> = {
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
    } as any;

    return { fs, http, git, shell, prompter, renderer } as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("command output via renderer.finish", () => {
    let ctx: ReturnType<typeof createMockContext>;

    beforeEach(() => {
        ctx = createMockContext();
    });

    it("list calls finish with empty plugins", async () => {
        await executeList(ctx, { json: true });
        expect(ctx.renderer.finish).toHaveBeenCalledWith(true, { plugins: [] });
    });

    it("list calls finish with plugins when installed", async () => {
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
        expect(ctx.renderer.finish).toHaveBeenCalledWith(
            true,
            expect.objectContaining({
                plugins: expect.arrayContaining([
                    expect.objectContaining({ name: "testPlugin" }),
                ]),
            }),
        );
    });

    it("search calls finish with results", async () => {
        await executeSearch(ctx, "test", { json: true });
        expect(ctx.renderer.finish).toHaveBeenCalledWith(
            true,
            expect.objectContaining({
                results: expect.any(Array),
            }),
        );
    });

    it("info calls finish for known plugin", async () => {
        await executeInfo(ctx, "testPlugin", { json: true });
        expect(ctx.renderer.finish).toHaveBeenCalledWith(
            true,
            expect.objectContaining({
                name: "testPlugin",
                version: "1.0.0",
            }),
        );
    });

    it("info calls finish(false) for unknown plugin", async () => {
        await executeInfo(ctx, "nonExistentPlugin", { json: true });
        expect(ctx.renderer.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("not found") }),
        );
        expect(ctx.renderer.finish).toHaveBeenCalledWith(false);
    });

    it("uninstall calls finish(false) for not-installed plugin", async () => {
        await executeUninstall(ctx, "nonExistentPlugin", { json: true });
        expect(ctx.renderer.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("not installed") }),
        );
        expect(ctx.renderer.finish).toHaveBeenCalledWith(false);
    });

    it("uninstall calls finish(true) when plugin removed", async () => {
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
        expect(ctx.renderer.finish).toHaveBeenCalledWith(true, { removed: "testPlugin" });
    });

    it("install calls finish(false) for not-found plugin", async () => {
        const options: InstallOptions = { json: true };
        await executeInstall(ctx, "nonExistentPlugin", options);
        expect(ctx.renderer.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("not found") }),
        );
        expect(ctx.renderer.finish).toHaveBeenCalledWith(false);
    });

    it("install calls finish(true) with installed array", async () => {
        const options: InstallOptions = { json: true, noBuild: true };
        await executeInstall(ctx, "testPlugin", options);
        expect(ctx.renderer.finish).toHaveBeenCalledWith(
            true,
            expect.objectContaining({
                installed: expect.any(Array),
            }),
        );
    });

    it("update calls finish with empty arrays when nothing installed", async () => {
        await executeUpdate(ctx, undefined, { json: true });
        expect(ctx.renderer.finish).toHaveBeenCalledWith(
            true,
            expect.objectContaining({
                updated: [],
                skipped: [],
            }),
        );
    });

    it("update calls finish with updated/skipped for installed plugins", async () => {
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
        expect(ctx.renderer.finish).toHaveBeenCalledWith(
            true,
            expect.objectContaining({
                updated: expect.any(Array),
            }),
        );
    });
});
