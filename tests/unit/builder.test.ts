import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
    DEPLOY_PATHS,
    buildVencord,
    deployDist,
    restartDiscord,
    buildAndDeploy,
} from "../../src/core/builder.js";
import type { FileSystem, ShellRunner } from "../../src/core/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeShellStub(overrides: Partial<{
    execExitCode: number;
    execResults: Array<{ stdout: string; stderr: string; exitCode: number }>;
}>= {}): ShellRunner {
    const results = overrides.execResults;
    let callIndex = 0;
    return {
        exec: vi.fn(async () => {
            if (results) {
                const r = results[callIndex] ?? results[results.length - 1];
                callIndex++;
                return r;
            }
            return { stdout: "", stderr: "", exitCode: overrides.execExitCode ?? 0 };
        }),
        spawn: vi.fn(async () => {}),
    } as unknown as ShellRunner;
}

function makeFsStub(existingPaths: Set<string> = new Set()): FileSystem {
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
        copyDir: vi.fn(async () => {}),
    } as unknown as FileSystem;
}

// ─── DEPLOY_PATHS ─────────────────────────────────────────────────────────────

describe("DEPLOY_PATHS", () => {
    it("has entries for linux, darwin, and win32", () => {
        expect(DEPLOY_PATHS).toHaveProperty("linux");
        expect(DEPLOY_PATHS).toHaveProperty("darwin");
        expect(DEPLOY_PATHS).toHaveProperty("win32");
    });

    it("linux path ends with Vencord/dist", () => {
        expect(DEPLOY_PATHS.linux).toMatch(/Vencord[/\\]dist$/);
    });

    it("darwin path ends with Vencord/dist inside Library/Application Support", () => {
        expect(DEPLOY_PATHS.darwin).toContain("Library");
        expect(DEPLOY_PATHS.darwin).toContain("Application Support");
        expect(DEPLOY_PATHS.darwin).toMatch(/Vencord[/\\]dist$/);
    });

    it("win32 path ends with Vencord/dist", () => {
        expect(DEPLOY_PATHS.win32).toMatch(/Vencord[/\\]dist$/);
    });
});

// ─── buildVencord ─────────────────────────────────────────────────────────────

describe("buildVencord", () => {
    it("runs pnpm build in the vencord directory", async () => {
        const shell = makeShellStub({ execExitCode: 0 });
        await buildVencord(shell, "/home/user/Vencord");

        expect(shell.exec).toHaveBeenCalledOnce();
        expect(shell.exec).toHaveBeenCalledWith("pnpm", ["build"], { cwd: "/home/user/Vencord" });
    });

    it("passes pnpm-specific env to the build subprocess", async () => {
        const shell = makeShellStub({ execExitCode: 0 });
        await buildVencord(shell, "/home/user/Vencord", { pnpmEnv: { CI: "true" } });

        expect(shell.exec).toHaveBeenCalledWith("pnpm", ["build"], {
            cwd: "/home/user/Vencord",
            env: { CI: "true" },
        });
    });

    it("resolves without error when exit code is 0", async () => {
        const shell = makeShellStub({ execExitCode: 0 });
        await expect(buildVencord(shell, "/home/user/Vencord")).resolves.toBeUndefined();
    });

    it("throws when pnpm build fails (non-zero exit code)", async () => {
        const shell = makeShellStub({
            execResults: [{ stdout: "", stderr: "Compilation error", exitCode: 1 }],
        });
        await expect(buildVencord(shell, "/home/user/Vencord")).rejects.toThrow(
            /pnpm build failed/
        );
    });

    it("includes the exit code in the error message", async () => {
        const shell = makeShellStub({
            execResults: [{ stdout: "", stderr: "type error", exitCode: 2 }],
        });
        await expect(buildVencord(shell, "/home/user/Vencord")).rejects.toThrow(/exit 2/);
    });

    it("includes stderr in the error when present", async () => {
        const shell = makeShellStub({
            execResults: [{ stdout: "", stderr: "TS2345: type error", exitCode: 1 }],
        });
        await expect(buildVencord(shell, "/home/user/Vencord")).rejects.toThrow("TS2345: type error");
    });
});

// ─── deployDist ───────────────────────────────────────────────────────────────

describe("deployDist", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("copies dist files when the deployed directory exists", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const deployPath = DEPLOY_PATHS.linux;
        const fs = makeFsStub(new Set([deployPath]));

        const result = await deployDist(fs, "/home/user/Vencord");

        expect(fs.copyDir).toHaveBeenCalledOnce();
        expect(fs.copyDir).toHaveBeenCalledWith("/home/user/Vencord/dist", deployPath);
        expect(result.deployed).toBe(true);
        expect(result.deployPath).toBe(deployPath);
    });

    it("creates the deploy directory when missing, then copies", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const deployPath = DEPLOY_PATHS.linux;
        const fs = makeFsStub(new Set()); // deploy dir missing

        const result = await deployDist(fs, "/home/user/Vencord");

        expect(fs.mkdir).toHaveBeenCalledWith(deployPath, { recursive: true });
        expect(fs.copyDir).toHaveBeenCalledWith("/home/user/Vencord/dist", deployPath);
        expect(result.deployed).toBe(true);
        expect(result.deployPath).toBe(deployPath);
    });

    it("uses the darwin deploy path on darwin platform", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
        const deployPath = DEPLOY_PATHS.darwin;
        const fs = makeFsStub(new Set([deployPath]));

        const result = await deployDist(fs, "/home/user/Vencord");

        expect(fs.copyDir).toHaveBeenCalledWith("/home/user/Vencord/dist", deployPath);
        expect(result.deployPath).toBe(deployPath);
    });

    it("uses the win32 deploy path on win32 platform", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        const deployPath = DEPLOY_PATHS.win32;
        const fs = makeFsStub(new Set([deployPath]));

        const result = await deployDist(fs, "C:\\Users\\user\\Vencord");

        expect(fs.copyDir).toHaveBeenCalledWith("C:\\Users\\user\\Vencord/dist", deployPath);
        expect(result.deployPath).toBe(deployPath);
    });
});

/**
 * Discovery mock for the verified-restart path: no processes during the kill
 * phase, a live Discord once the launch has happened.
 */
function mockProcessAppearsAfterLaunch(fs: FileSystem, shell: ShellRunner, pid = "42") {
    let launched = false;
    (shell.spawn as ReturnType<typeof vi.fn>).mockImplementation(async () => { launched = true; });
    (fs.readdir as ReturnType<typeof vi.fn>).mockImplementation(async () => (launched ? [pid] : []));
    (fs.readlink as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
        if (path === `/proc/${pid}/exe`) return "/opt/discord/Discord";
        throw new Error("ENOENT");
    });
}

/** Restart options that keep unit tests off the real environment and fast. */
const TEST_RESTART: { platform: "linux"; env: Record<string, string>; settleMs: number } = {
    platform: "linux",
    env: { DISPLAY: ":0" },
    settleMs: 10,
};

// ─── restartDiscord ───────────────────────────────────────────────────────────

describe("restartDiscord", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("kills Discord processes and respawns the binary", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        // No running Discord processes — kill is a no-op, spawn still happens.
        const fs = makeFsStub(new Set());
        (fs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const shell = makeShellStub({ execExitCode: 0 });

        mockProcessAppearsAfterLaunch(fs, shell);

        const promise = restartDiscord(fs, shell, "/usr/bin/discord", TEST_RESTART);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(shell.spawn).toHaveBeenCalledWith("/usr/bin/discord", [], expect.objectContaining({ detached: true }));
        expect(result).toMatchObject({ verified: true, pids: [42] });
    });

    it("spawns with detached:true so Discord outlives the venpm process", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub(new Set());
        (fs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const shell = makeShellStub({ execExitCode: 0 });

        mockProcessAppearsAfterLaunch(fs, shell);

        const promise = restartDiscord(fs, shell, "/usr/bin/discord", TEST_RESTART);
        await vi.runAllTimersAsync();
        await promise;

        const spawnCall = (shell.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(spawnCall[2]).toMatchObject({ detached: true });
    });

    it("does not respawn when existing Discord processes remain alive", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub(new Set());
        (fs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue(["42"]);
        (fs.readlink as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
            if (path === "/proc/42/exe") return "/opt/discord/Discord";
            throw new Error("ENOENT");
        });
        (fs.exists as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => path === "/proc/42");
        const shell = makeShellStub({ execExitCode: 0 });

        const promise = expect(
            restartDiscord(fs, shell, "/usr/bin/discord", TEST_RESTART)
        ).rejects.toThrow(/still running/);
        await vi.runAllTimersAsync();
        await promise;
        expect(shell.spawn).not.toHaveBeenCalled();
    });
});

// ─── buildAndDeploy ───────────────────────────────────────────────────────────

describe("buildAndDeploy", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("runs build and deploy without restart by default", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const deployPath = DEPLOY_PATHS.linux;
        const fs = makeFsStub(new Set([deployPath]));
        const shell = makeShellStub({ execExitCode: 0 });

        const result = await buildAndDeploy(fs, shell, "/home/user/Vencord");

        expect(shell.exec).toHaveBeenCalledWith("pnpm", ["build"], { cwd: "/home/user/Vencord" });
        expect(fs.copyDir).toHaveBeenCalledOnce();
        expect(shell.spawn).not.toHaveBeenCalled();
        expect(result.deployed).toBe(true);
    });

    it("passes pnpm-specific env through orchestration", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const deployPath = DEPLOY_PATHS.linux;
        const fs = makeFsStub(new Set([deployPath]));
        const shell = makeShellStub({ execExitCode: 0 });

        await buildAndDeploy(fs, shell, "/home/user/Vencord", {
            pnpmEnv: { CI: "true" },
        });

        expect(shell.exec).toHaveBeenCalledWith("pnpm", ["build"], {
            cwd: "/home/user/Vencord",
            env: { CI: "true" },
        });
    });

    it("restarts discord when restart:true and discordBinary is provided", async () => {
        vi.useFakeTimers();
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const deployPath = DEPLOY_PATHS.linux;
        const fs = makeFsStub(new Set([deployPath]));
        (fs.readdir as ReturnType<typeof vi.fn>).mockResolvedValue([]);
        const shell = makeShellStub({ execExitCode: 0 });

        mockProcessAppearsAfterLaunch(fs, shell);

        const promise = buildAndDeploy(fs, shell, "/home/user/Vencord", {
            restart: true,
            discordBinary: "/usr/bin/discord",
            restartOptions: TEST_RESTART,
        });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(shell.spawn).toHaveBeenCalledWith("/usr/bin/discord", [], expect.objectContaining({ detached: true }));
        expect(result.deployed).toBe(true);
        expect(result.restarted).toBe(true);
        expect(result.restartedPids).toEqual([42]);
    });

    it("does not restart when restart:true but discordBinary is not provided", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const deployPath = DEPLOY_PATHS.linux;
        const fs = makeFsStub(new Set([deployPath]));
        const shell = makeShellStub({ execExitCode: 0 });

        await buildAndDeploy(fs, shell, "/home/user/Vencord", { restart: true });

        expect(shell.spawn).not.toHaveBeenCalled();
    });

    it("propagates build failures", async () => {
        const fs = makeFsStub();
        const shell = makeShellStub({
            execResults: [{ stdout: "", stderr: "type error", exitCode: 1 }],
        });

        await expect(
            buildAndDeploy(fs, shell, "/home/user/Vencord")
        ).rejects.toThrow(/pnpm build failed/);

        expect(fs.copyDir).not.toHaveBeenCalled();
    });

    it("creates the deploy dir and returns deployed:true on first run", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub(new Set()); // no deploy dir yet
        const shell = makeShellStub({ execExitCode: 0 });

        const result = await buildAndDeploy(fs, shell, "/home/user/Vencord");

        expect(fs.mkdir).toHaveBeenCalled();
        expect(result.deployed).toBe(true);
    });
});
