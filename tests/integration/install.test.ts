import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mocked } from "vitest";
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
    InstallOptions,
} from "../../src/core/types.js";
import { executeInstall } from "../../src/cli/install.js";

// Mock tar and node fs/promises writes so tarball tests don't need real archives
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

// ─── Mock Index ───────────────────────────────────────────────────────────────

const MOCK_INDEX = {
    name: "test-repo",
    description: "Test repository",
    plugins: {
        simplePlugin: {
            version: "1.0.0",
            description: "A simple plugin",
            authors: [{ name: "kamaras", id: "111222333" }],
            source: { git: "https://example.com/simplePlugin.git" },
        },
        pluginWithDeps: {
            version: "2.0.0",
            description: "A plugin with dependencies",
            authors: [{ name: "kamaras", id: "111222333" }],
            dependencies: ["depPlugin"],
            source: { git: "https://example.com/pluginWithDeps.git" },
        },
        depPlugin: {
            version: "1.1.0",
            description: "A dependency plugin",
            authors: [{ name: "kamaras", id: "111222333" }],
            source: { git: "https://example.com/depPlugin.git" },
        },
        tarballPlugin: {
            version: "0.5.0",
            description: "A tarball-only plugin",
            authors: [{ name: "kamaras", id: "111222333" }],
            source: { tarball: "https://cdn.example.com/tarballPlugin-0.5.0.tar.gz" },
        },
    },
};

// ─── Mock Config ──────────────────────────────────────────────────────────────

const MOCK_CONFIG: Config = {
    repos: [{ name: "test-repo", url: "https://example.com/plugins.json" }],
    vencord: { path: "/home/user/Vencord" },
    rebuild: "never",
    discord: { restart: "never", binary: null },
};

// ─── Mock Context Factory ─────────────────────────────────────────────────────

function createMockContext(overrides?: {
    gitAvailable?: boolean;
    lockfile?: LockfileData;
    confirmResult?: boolean;
}): IOContext & {
    git: Mocked<GitClient>;
    http: Mocked<HttpClient>;
    fs: Mocked<FileSystem>;
    shell: Mocked<ShellRunner>;
    prompter: Mocked<Prompter>;
    renderer: Mocked<Renderer>;
} {
    const gitAvailable = overrides?.gitAvailable ?? true;
    const lockfileData: LockfileData = overrides?.lockfile ?? { installed: {} };
    const confirmResult = overrides?.confirmResult ?? true;

    const fs: Mocked<FileSystem> = {
        readFile: vi.fn().mockImplementation(async (path: string) => {
            // Return config JSON for config path, lockfile JSON for lockfile path
            if (path.includes("config.json")) {
                return JSON.stringify(MOCK_CONFIG);
            }
            if (path.includes("venpm-lock.json")) {
                return JSON.stringify(lockfileData);
            }
            return "";
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockImplementation(async (path: string) => {
            // Config and lockfile exist
            if (path.includes("config.json") || path.includes("venpm-lock.json")) return true;
            // Vencord path exists
            if (path.includes("/home/user/Vencord")) return true;
            // Local dev paths exist
            if (path.includes("/home/user/dev/")) return true;
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

    const http: Mocked<HttpClient> = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
            if (url.includes("plugins.json")) {
                return {
                    ok: true,
                    status: 200,
                    text: vi.fn().mockResolvedValue(JSON.stringify(MOCK_INDEX)),
                    json: vi.fn().mockResolvedValue(MOCK_INDEX),
                    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
                };
            }
            if (url.includes(".tar.gz")) {
                return {
                    ok: true,
                    status: 200,
                    text: vi.fn().mockResolvedValue(""),
                    json: vi.fn().mockResolvedValue({}),
                    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
                };
            }
            return {
                ok: false,
                status: 404,
                text: vi.fn().mockResolvedValue("Not Found"),
                json: vi.fn().mockResolvedValue({}),
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
            };
        }),
    } as any;

    const git: Mocked<GitClient> = {
        available: vi.fn().mockResolvedValue(gitAvailable),
        clone: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        revParse: vi.fn().mockResolvedValue("abc1234567890"),
        checkout: vi.fn().mockResolvedValue(undefined),
    } as any;

    const shell: Mocked<ShellRunner> = {
        exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
        spawn: vi.fn().mockResolvedValue(undefined),
    } as any;

    const prompter: Mocked<Prompter> = {
        confirm: vi.fn().mockResolvedValue(confirmResult),
        input: vi.fn().mockResolvedValue(""),
        select: vi.fn().mockResolvedValue(""),
    } as any;

    const renderer: Mocked<Renderer> = {
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

    return { fs, http, git, shell, prompter, renderer };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeInstall", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset exit code
        process.exitCode = undefined;
    });

    it("installs a simple plugin via git", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = {};

        await executeInstall(ctx, "simplePlugin", options);

        // git.clone should have been called once for simplePlugin
        expect(ctx.git.clone).toHaveBeenCalledOnce();
        expect(ctx.git.clone).toHaveBeenCalledWith(
            "https://example.com/simplePlugin.git",
            expect.stringContaining("simplePlugin"),
            expect.objectContaining({}),
        );

        // success should have been logged
        expect(ctx.renderer.success).toHaveBeenCalledWith(
            expect.stringContaining("simplePlugin"),
        );

        // Lockfile should have been written
        expect(ctx.fs.writeFile).toHaveBeenCalledWith(
            expect.stringContaining("venpm-lock.json"),
            expect.stringContaining("simplePlugin"),
        );
    });

    it("installs dependencies automatically", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = {};

        await executeInstall(ctx, "pluginWithDeps", options);

        // git.clone should have been called twice (depPlugin + pluginWithDeps)
        expect(ctx.git.clone).toHaveBeenCalledTimes(2);

        const cloneUrls = ctx.git.clone.mock.calls.map(call => call[0]);
        expect(cloneUrls).toContain("https://example.com/depPlugin.git");
        expect(cloneUrls).toContain("https://example.com/pluginWithDeps.git");

        expect(ctx.renderer.success).toHaveBeenCalledWith(
            expect.stringContaining("pluginWithDeps"),
        );
    });

    it("skips already-installed dependencies", async () => {
        const existingLockfile: LockfileData = {
            installed: {
                depPlugin: {
                    version: "1.1.0",
                    repo: "test-repo",
                    method: "git",
                    pinned: false,
                    git_ref: "existingRef",
                    installed_at: new Date().toISOString(),
                },
            },
        };

        const ctx = createMockContext({ lockfile: existingLockfile });
        const options: InstallOptions = {};

        await executeInstall(ctx, "pluginWithDeps", options);

        // Only pluginWithDeps should be cloned (depPlugin already installed)
        expect(ctx.git.clone).toHaveBeenCalledOnce();
        expect(ctx.git.clone).toHaveBeenCalledWith(
            "https://example.com/pluginWithDeps.git",
            expect.stringContaining("pluginWithDeps"),
            expect.objectContaining({}),
        );
    });

    it("reports error when plugin not found", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = {};

        await executeInstall(ctx, "nonExistentPlugin", options);

        expect(ctx.renderer.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("nonExistentPlugin") }),
        );
        expect(process.exitCode).toBe(1);

        // No install should have happened
        expect(ctx.git.clone).not.toHaveBeenCalled();
    });

    it("falls back to tarball when git unavailable", async () => {
        const ctx = createMockContext({ gitAvailable: false });
        const options: InstallOptions = {};

        await executeInstall(ctx, "tarballPlugin", options);

        // Should not have tried to clone (git unavailable and plugin has no git source)
        expect(ctx.git.clone).not.toHaveBeenCalled();

        // Should have fetched tarball via http
        expect(ctx.http.fetch).toHaveBeenCalledWith(
            "https://cdn.example.com/tarballPlugin-0.5.0.tar.gz",
        );

        expect(ctx.renderer.success).toHaveBeenCalledWith(
            expect.stringContaining("tarballPlugin"),
        );
    });

    it("installs via tarball when --tarball flag is set", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = { tarball: true };

        await executeInstall(ctx, "tarballPlugin", options);

        expect(ctx.git.clone).not.toHaveBeenCalled();
        expect(ctx.http.fetch).toHaveBeenCalledWith(
            "https://cdn.example.com/tarballPlugin-0.5.0.tar.gz",
        );
        expect(ctx.renderer.success).toHaveBeenCalledWith(
            expect.stringContaining("tarballPlugin"),
        );
    });

    it("cancels installation when user declines confirmation", async () => {
        const ctx = createMockContext({ confirmResult: false });
        const options: InstallOptions = {};

        await executeInstall(ctx, "simplePlugin", options);

        expect(ctx.git.clone).not.toHaveBeenCalled();
        expect(ctx.fs.writeFile).not.toHaveBeenCalledWith(
            expect.stringContaining("venpm-lock.json"),
            expect.anything(),
            expect.anything(),
        );
        expect(ctx.renderer.text).toHaveBeenCalledWith(
            expect.stringContaining("cancelled"),
        );
    });

    it("installs from local path via --local", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = { local: "/home/user/dev/myPlugin" };

        await executeInstall(ctx, "myPlugin", options);

        expect(ctx.fs.symlink).toHaveBeenCalledWith(
            "/home/user/dev/myPlugin",
            expect.stringContaining("myPlugin"),
        );
        expect(ctx.renderer.success).toHaveBeenCalledWith(
            expect.stringContaining("myPlugin"),
        );

        // Should not fetch indexes for local installs
        expect(ctx.http.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining("plugins.json"),
        );
    });

    it("installs from specific repo via --from", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = { from: "test-repo" };

        await executeInstall(ctx, "simplePlugin", options);

        expect(ctx.git.clone).toHaveBeenCalledOnce();
        expect(ctx.renderer.success).toHaveBeenCalledWith(
            expect.stringContaining("simplePlugin"),
        );
    });

    it("errors when --from targets a non-existent repo", async () => {
        const ctx = createMockContext();
        const options: InstallOptions = { from: "unknown-repo" };

        await executeInstall(ctx, "simplePlugin", options);

        expect(ctx.renderer.error).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("unknown-repo") }),
        );
        expect(process.exitCode).toBe(1);
    });
});
