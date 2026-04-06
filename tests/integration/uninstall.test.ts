import { describe, it, expect, vi } from "vitest";
import type { FileSystem, IOContext, InstalledPlugin, LockfileData, Config } from "../../src/core/types.js";
import { executeUninstall } from "../../src/cli/uninstall.js";
import { getLockfilePath } from "../../src/core/paths.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockFs(files: Record<string, string> = {}): FileSystem & { written: Record<string, string>; removed: string[] } {
    const store = { ...files };
    const written: Record<string, string> = {};
    const removed: string[] = [];
    return {
        written,
        removed,
        readFile: vi.fn(async (path: string) => {
            if (!(path in store)) throw new Error(`ENOENT: ${path}`);
            return store[path];
        }),
        writeFile: vi.fn(async (path: string, data: string) => {
            store[path] = data;
            written[path] = data;
        }),
        exists: vi.fn(async (path: string) => path in store),
        mkdir: vi.fn(async () => {}),
        rm: vi.fn(async (path: string) => { removed.push(path); }),
        symlink: vi.fn(async () => {}),
        readlink: vi.fn(async () => ""),
        readdir: vi.fn(async () => [] as string[]),
        stat: vi.fn(async () => ({ isDirectory: () => false, isFile: () => true, size: 0 })),
        lstat: vi.fn(async () => ({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })),
        copyDir: vi.fn(async () => {}),
    };
}

function makeCtx(fs: FileSystem, confirmResult = true): IOContext {
    return {
        fs,
        http: {
            fetch: vi.fn(async () => ({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ name: "kamaras", description: "", plugins: {} }),
                json: async () => ({ name: "kamaras", description: "", plugins: {} }),
                arrayBuffer: async () => new ArrayBuffer(0),
            })),
        },
        git: {
            available: vi.fn(async () => true),
            clone: vi.fn(async () => {}),
            pull: vi.fn(async () => {}),
            revParse: vi.fn(async () => "abc1234"),
            checkout: vi.fn(async () => {}),
        },
        shell: {
            exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
            spawn: vi.fn(async () => {}),
        },
        prompter: {
            confirm: vi.fn(async () => confirmResult),
            input: vi.fn(async () => ""),
            select: vi.fn(async () => "" as never),
        },
        logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            verbose: vi.fn(),
            success: vi.fn(),
        },
    };
}

// ─── Test data ────────────────────────────────────────────────────────────────

const CONFIG_PATH = "/home/user/.config/venpm/config.json";
const LOCK_PATH = getLockfilePath();

const VENCORD_PATH = "/home/user/src/Vencord";

const configWithVencord: Config = {
    repos: [{ name: "kamaras", url: "https://example.com/plugins.json" }],
    vencord: { path: VENCORD_PATH },
    rebuild: "never",
    discord: { restart: "never", binary: null },
};

const configNoVencord: Config = {
    repos: [{ name: "kamaras", url: "https://example.com/plugins.json" }],
    vencord: { path: null },
    rebuild: "never",
    discord: { restart: "never", binary: null },
};

const installedEntry: InstalledPlugin = {
    version: "1.0.0",
    repo: "kamaras",
    method: "git",
    pinned: false,
    installed_at: "2026-04-06T12:00:00Z",
};

const lockfileWith: LockfileData = {
    installed: { channelTabs: installedEntry },
};

const lockfileEmpty: LockfileData = { installed: {} };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeUninstall", () => {
    it("removes the plugin directory and updates the lockfile", async () => {
        const fs = makeMockFs({
            [CONFIG_PATH]: JSON.stringify(configWithVencord),
            [LOCK_PATH]: JSON.stringify(lockfileWith),
        });
        const ctx = makeCtx(fs, true);

        await executeUninstall(ctx, "channelTabs", { config: CONFIG_PATH });

        // Plugin directory should have been removed
        const expectedDir = `${VENCORD_PATH}/src/userplugins/channelTabs`;
        expect(fs.removed).toContain(expectedDir);

        // Lockfile should be written without channelTabs
        const writtenLock = JSON.parse(fs.written[LOCK_PATH]) as LockfileData;
        expect(writtenLock.installed.channelTabs).toBeUndefined();
    });

    it("reports an error when the plugin is not installed", async () => {
        const fs = makeMockFs({
            [CONFIG_PATH]: JSON.stringify(configWithVencord),
            [LOCK_PATH]: JSON.stringify(lockfileEmpty),
        });
        const ctx = makeCtx(fs, true);
        const originalExitCode = process.exitCode;

        await executeUninstall(ctx, "channelTabs", { config: CONFIG_PATH });

        expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining("channelTabs"));
        expect(process.exitCode).toBe(1);

        process.exitCode = originalExitCode;
    });

    it("does not remove the plugin when confirmation is denied", async () => {
        const fs = makeMockFs({
            [CONFIG_PATH]: JSON.stringify(configWithVencord),
            [LOCK_PATH]: JSON.stringify(lockfileWith),
        });
        const ctx = makeCtx(fs, false);

        await executeUninstall(ctx, "channelTabs", { config: CONFIG_PATH });

        // No removal should have happened
        expect(fs.removed).toHaveLength(0);

        // Lockfile should NOT be written (no changes)
        expect(fs.written[LOCK_PATH]).toBeUndefined();
    });

    it("skips directory removal when vencord path is not configured", async () => {
        const fs = makeMockFs({
            [CONFIG_PATH]: JSON.stringify(configNoVencord),
            [LOCK_PATH]: JSON.stringify(lockfileWith),
        });
        const ctx = makeCtx(fs, true);

        await executeUninstall(ctx, "channelTabs", { config: CONFIG_PATH });

        expect(fs.removed).toHaveLength(0);

        const writtenLock = JSON.parse(fs.written[LOCK_PATH]) as LockfileData;
        expect(writtenLock.installed.channelTabs).toBeUndefined();
    });
});
