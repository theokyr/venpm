import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
    detectVencordPath,
    detectDiscordBinary,
    checkGitAvailable,
    checkPnpmAvailable,
    VENCORD_SEARCH_PATHS,
    resolveTilde,
} from "../../src/core/detect.js";
import type { FileSystem, ShellRunner } from "../../src/core/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFsStub(existingPaths: Set<string>): FileSystem {
    return {
        exists: vi.fn(async (p: string) => existingPaths.has(p)),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        rm: vi.fn(),
        symlink: vi.fn(),
        readlink: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
        lstat: vi.fn(),
        copyDir: vi.fn(),
    } as unknown as FileSystem;
}

function makeShellStub(exitCode: number): ShellRunner {
    return {
        exec: vi.fn(async () => ({ stdout: "1.0.0", stderr: "", exitCode })),
        spawn: vi.fn(),
    } as unknown as ShellRunner;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectVencordPath", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it("returns env var path when VENPM_VENCORD_PATH is set and exists", async () => {
        process.env.VENPM_VENCORD_PATH = "/opt/my-vencord";
        const fs = makeFsStub(new Set(["/opt/my-vencord/package.json"]));

        const result = await detectVencordPath(fs);
        expect(result).toBe("/opt/my-vencord");
    });

    it("returns null when VENPM_VENCORD_PATH is set but path does not exist", async () => {
        process.env.VENPM_VENCORD_PATH = "/opt/nonexistent";
        const fs = makeFsStub(new Set());

        const result = await detectVencordPath(fs);
        expect(result).toBeNull();
    });

    it("does not scan common paths when env var is set (even if they would match)", async () => {
        process.env.VENPM_VENCORD_PATH = "/opt/nonexistent";
        // Make a common path valid to confirm it is never returned
        const resolved = resolveTilde(VENCORD_SEARCH_PATHS[0]);
        const fs = makeFsStub(new Set([`${resolved}/package.json`]));

        const result = await detectVencordPath(fs);
        expect(result).toBeNull();
    });

    it("scans common paths when env var is not set and returns first match", async () => {
        delete process.env.VENPM_VENCORD_PATH;
        const secondPath = resolveTilde(VENCORD_SEARCH_PATHS[1]);
        const fs = makeFsStub(new Set([`${secondPath}/package.json`]));

        const result = await detectVencordPath(fs);
        expect(result).toBe(secondPath);
    });

    it("returns null when no common path exists", async () => {
        delete process.env.VENPM_VENCORD_PATH;
        const fs = makeFsStub(new Set());

        const result = await detectVencordPath(fs);
        expect(result).toBeNull();
    });

    it("returns the first matching common path (not a later one)", async () => {
        delete process.env.VENPM_VENCORD_PATH;
        const firstPath = resolveTilde(VENCORD_SEARCH_PATHS[0]);
        const thirdPath = resolveTilde(VENCORD_SEARCH_PATHS[2]);
        const fs = makeFsStub(
            new Set([`${firstPath}/package.json`, `${thirdPath}/package.json`])
        );

        const result = await detectVencordPath(fs);
        expect(result).toBe(firstPath);
    });
});

describe("checkGitAvailable", () => {
    it("returns true when git --version exits with code 0", async () => {
        const shell = makeShellStub(0);
        expect(await checkGitAvailable(shell)).toBe(true);
        expect(shell.exec).toHaveBeenCalledWith("git", ["--version"]);
    });

    it("returns false when git --version exits with non-zero code", async () => {
        const shell = makeShellStub(1);
        expect(await checkGitAvailable(shell)).toBe(false);
    });

    it("returns false when exec throws (git not on PATH)", async () => {
        const shell: ShellRunner = {
            exec: vi.fn(async () => { throw new Error("ENOENT"); }),
            spawn: vi.fn(),
        } as unknown as ShellRunner;
        expect(await checkGitAvailable(shell)).toBe(false);
    });
});

describe("checkPnpmAvailable", () => {
    it("returns true when pnpm --version exits with code 0", async () => {
        const shell = makeShellStub(0);
        expect(await checkPnpmAvailable(shell)).toBe(true);
        expect(shell.exec).toHaveBeenCalledWith("pnpm", ["--version"]);
    });

    it("returns false when pnpm --version exits with non-zero code", async () => {
        const shell = makeShellStub(127);
        expect(await checkPnpmAvailable(shell)).toBe(false);
    });

    it("returns false when exec throws (pnpm not on PATH)", async () => {
        const shell: ShellRunner = {
            exec: vi.fn(async () => { throw new Error("ENOENT"); }),
            spawn: vi.fn(),
        } as unknown as ShellRunner;
        expect(await checkPnpmAvailable(shell)).toBe(false);
    });
});

describe("detectDiscordBinary", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns the first existing binary path (linux)", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub(new Set(["/usr/bin/discord"]));

        const result = await detectDiscordBinary(fs);
        expect(result).toBe("/usr/bin/discord");
    });

    it("returns a later candidate when the first does not exist (linux)", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub(new Set(["/usr/bin/vesktop"]));

        const result = await detectDiscordBinary(fs);
        expect(result).toBe("/usr/bin/vesktop");
    });

    it("returns null when no binary is found (linux)", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub(new Set());

        const result = await detectDiscordBinary(fs);
        expect(result).toBeNull();
    });

    it("checks macOS paths when platform is darwin", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
        const fs = makeFsStub(
            new Set(["/Applications/Discord.app/Contents/MacOS/Discord"])
        );

        const result = await detectDiscordBinary(fs);
        expect(result).toBe("/Applications/Discord.app/Contents/MacOS/Discord");
    });

    it("returns null on Windows (no candidates)", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        const fs = makeFsStub(new Set());

        const result = await detectDiscordBinary(fs);
        expect(result).toBeNull();
    });
});
