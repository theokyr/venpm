import { describe, it, expect, vi } from "vitest";
import { resolveLaunchPlan, launchDiscordVerified } from "../../src/core/launch.js";
import type { FileSystem, ShellRunner } from "../../src/core/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LINUX_BINARY = "/usr/bin/discord";
const MAC_BINARY = "/Applications/Discord.app/Contents/MacOS/Discord";

/**
 * Discovery goes through `/proc` on Linux, so the stub answers readdir/readlink.
 * `aliveSequence` lets a test model a process that appears and then dies.
 */
function makeFsStub(aliveSequence: boolean[], logContent = ""): FileSystem {
    let call = 0;
    return {
        readdir: vi.fn(async () => {
            const alive = aliveSequence[Math.min(call++, aliveSequence.length - 1)];
            return alive ? ["4242"] : [];
        }),
        readlink: vi.fn(async () => LINUX_BINARY),
        readFile: vi.fn(async () => logContent),
        exists: vi.fn(async () => true),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        rm: vi.fn(),
        symlink: vi.fn(),
        stat: vi.fn(),
        lstat: vi.fn(),
        copyDir: vi.fn(),
    } as unknown as FileSystem;
}

function makeShellStub(): ShellRunner {
    return {
        exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
        spawn: vi.fn(async () => {}),
    } as unknown as ShellRunner;
}

// ─── resolveLaunchPlan ───────────────────────────────────────────────────────

describe("resolveLaunchPlan", () => {
    describe("linux", () => {
        it("passes through untouched when DISPLAY is set", () => {
            const plan = resolveLaunchPlan("linux", { DISPLAY: ":0" }, LINUX_BINARY);
            expect(plan).toMatchObject({ command: LINUX_BINARY, args: [], unsetEnv: [], problem: null });
        });

        it("never forces a display backend flag when an X display exists", () => {
            // Forcing --ozone-platform=wayland on an Xwayland session crash-loops
            // the GPU process and hangs Discord on "Starting...".
            expect(resolveLaunchPlan("linux", { DISPLAY: ":1" }, LINUX_BINARY).args).toEqual([]);
            expect(
                resolveLaunchPlan("linux", { DISPLAY: "" }, LINUX_BINARY, { DISPLAY: ":1" }).args,
            ).toEqual([]);
        });

        it("does not trust an inherited WAYLAND_DISPLAY over the session", () => {
            // An agent shell inherits WAYLAND_DISPLAY while the session runs its
            // apps on Xwayland — the stale variable must not win.
            const plan = resolveLaunchPlan(
                "linux",
                { WAYLAND_DISPLAY: "wayland-0", XDG_RUNTIME_DIR: "/run/user/1000" },
                LINUX_BINARY,
                { DISPLAY: ":1", XDG_RUNTIME_DIR: "/run/user/1000" },
            );
            expect(plan.env["DISPLAY"]).toBe(":1");
            expect(plan.args).toEqual([]);
        });

        it("hints rather than forces on a Wayland-only session", () => {
            const plan = resolveLaunchPlan(
                "linux",
                { DISPLAY: "" },
                LINUX_BINARY,
                { WAYLAND_DISPLAY: "wayland-0", XDG_RUNTIME_DIR: "/run/user/1000" },
            );
            expect(plan.args).toEqual(["--ozone-platform-hint=auto"]);
            expect(plan.unsetEnv).toContain("DISPLAY");
            expect(plan.problem).toBeNull();
        });

        it("borrows the desktop session display when this shell has none", () => {
            // The exact shape of a Claude Code / CI shell: DISPLAY="" and nothing else.
            const plan = resolveLaunchPlan(
                "linux",
                { DISPLAY: "" },
                LINUX_BINARY,
                { DISPLAY: ":1", XAUTHORITY: "/run/user/1000/xauth_x", XDG_RUNTIME_DIR: "/run/user/1000" },
            );
            expect(plan.env).toMatchObject({ DISPLAY: ":1", XAUTHORITY: "/run/user/1000/xauth_x" });
            expect(plan.args).toEqual([]);
            expect(plan.problem).toBeNull();
        });

        it("prefers this shell's own display over the session's", () => {
            const plan = resolveLaunchPlan("linux", { DISPLAY: ":0" }, LINUX_BINARY, { DISPLAY: ":1" });
            expect(plan.env).toEqual({});
            expect(plan.problem).toBeNull();
        });

        it("refuses to launch when neither this shell nor the session has a display", () => {
            const plan = resolveLaunchPlan("linux", {}, LINUX_BINARY, {});
            expect(plan.problem).toMatch(/No usable display/);
        });

        it("treats whitespace-only DISPLAY as unset", () => {
            const plan = resolveLaunchPlan("linux", { DISPLAY: "   " }, LINUX_BINARY);
            expect(plan.problem).toMatch(/No usable display/);
        });

        it("ignores a session Wayland socket with no runtime dir", () => {
            const plan = resolveLaunchPlan("linux", {}, LINUX_BINARY, { WAYLAND_DISPLAY: "wayland-0" });
            expect(plan.problem).toMatch(/No usable display/);
            expect(plan.env).toEqual({});
        });
    });

    describe("darwin", () => {
        it("launches app bundles through open -a so launchd owns the GUI session", () => {
            const plan = resolveLaunchPlan("darwin", {}, MAC_BINARY);
            expect(plan.command).toBe("open");
            expect(plan.args).toEqual(["-a", "/Applications/Discord.app"]);
            expect(plan.problem).toBeNull();
        });

        it("falls back to a direct spawn for a non-bundle binary", () => {
            const plan = resolveLaunchPlan("darwin", {}, "/usr/local/bin/discord");
            expect(plan.command).toBe("/usr/local/bin/discord");
            expect(plan.problem).toBeNull();
        });

        it("ignores X11 variables entirely", () => {
            const plan = resolveLaunchPlan("darwin", { DISPLAY: "" }, MAC_BINARY);
            expect(plan.unsetEnv).toEqual([]);
            expect(plan.problem).toBeNull();
        });
    });

    describe("win32", () => {
        it("spawns the binary directly with no display negotiation", () => {
            const plan = resolveLaunchPlan("win32", { DISPLAY: "" }, "C:/Discord/Discord.exe");
            expect(plan).toMatchObject({
                command: "C:/Discord/Discord.exe",
                args: [],
                unsetEnv: [],
                problem: null,
            });
        });
    });
});

// ─── launchDiscordVerified ───────────────────────────────────────────────────

describe("launchDiscordVerified", () => {
    const env = { DISPLAY: ":0" };

    it("returns the live PIDs when the process starts and stays up", async () => {
        const fs = makeFsStub([true]);
        const shell = makeShellStub();

        const result = await launchDiscordVerified(fs, shell, LINUX_BINARY, {
            platform: "linux",
            env,
            settleMs: 10,
        });

        expect(result).toEqual({ verified: true, pids: [4242] });
        expect(shell.spawn).toHaveBeenCalledWith(LINUX_BINARY, [], expect.objectContaining({ detached: true }));
    });

    it("fails when the process never appears, quoting the launch log", async () => {
        const fs = makeFsStub([false], "Missing X server or $DISPLAY\nThe platform failed to initialize.");
        const shell = makeShellStub();

        await expect(
            launchDiscordVerified(fs, shell, LINUX_BINARY, {
                platform: "linux",
                env,
                startupTimeoutMs: 30,
                logFile: "/tmp/venpm-test.log",
            }),
        ).rejects.toThrow(/did not start[\s\S]*Missing X server/);
    });

    it("fails when the process appears and then dies inside the settle window", async () => {
        // Appears on the first poll, gone by the settle check — the exact failure
        // that used to be reported as a successful restart.
        const fs = makeFsStub([true, false], "The platform failed to initialize.  Exiting.");
        const shell = makeShellStub();

        await expect(
            launchDiscordVerified(fs, shell, LINUX_BINARY, {
                platform: "linux",
                env,
                settleMs: 10,
                logFile: "/tmp/venpm-test.log",
            }),
        ).rejects.toThrow(/exited within/);
    });

    it("refuses to spawn at all when the environment cannot show a window", async () => {
        const fs = makeFsStub([true]);
        const shell = makeShellStub();

        await expect(
            launchDiscordVerified(fs, shell, LINUX_BINARY, { platform: "linux", env: {} }),
        ).rejects.toThrow(/No usable display/);
        expect(shell.spawn).not.toHaveBeenCalled();
    });

    it("falls back to the systemd session environment", async () => {
        const fs = makeFsStub([true]);
        const shell = makeShellStub();
        (shell.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
            stdout: "XDG_RUNTIME_DIR=/run/user/1000\nDISPLAY=:1\nXAUTHORITY=/run/user/1000/xauth_x\nLANG=en_US.UTF-8",
            stderr: "",
            exitCode: 0,
        });

        await launchDiscordVerified(fs, shell, LINUX_BINARY, {
            platform: "linux",
            env: { DISPLAY: "" },
            settleMs: 10,
        });

        expect(shell.exec).toHaveBeenCalledWith("systemctl", ["--user", "show-environment"]);
        expect(shell.spawn).toHaveBeenCalledWith(
            LINUX_BINARY,
            [],
            // The imported DISPLAY overrides the empty inherited one, so there is
            // nothing left to unset.
            expect.objectContaining({
                env: expect.objectContaining({ DISPLAY: ":1", XAUTHORITY: "/run/user/1000/xauth_x" }),
                unsetEnv: [],
            }),
        );
    });

    it("uses the session Wayland socket, with a hint, when it has no X display", async () => {
        const fs = makeFsStub([true]);
        const shell = makeShellStub();
        (shell.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
            stdout: "WAYLAND_DISPLAY=wayland-0\nXDG_RUNTIME_DIR=/run/user/1000",
            stderr: "",
            exitCode: 0,
        });

        await launchDiscordVerified(fs, shell, LINUX_BINARY, {
            platform: "linux",
            env: { DISPLAY: "" },
            settleMs: 10,
        });

        expect(shell.spawn).toHaveBeenCalledWith(
            LINUX_BINARY,
            ["--ozone-platform-hint=auto"],
            expect.objectContaining({
                env: expect.objectContaining({ WAYLAND_DISPLAY: "wayland-0" }),
                unsetEnv: ["DISPLAY"],
            }),
        );
    });

    it("fails clearly when the session has no display either", async () => {
        const fs = makeFsStub([true]);
        const shell = makeShellStub();
        (shell.exec as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: "LANG=C", stderr: "", exitCode: 0 });

        await expect(
            launchDiscordVerified(fs, shell, LINUX_BINARY, { platform: "linux", env: {} }),
        ).rejects.toThrow(/No usable display/);
        expect(shell.spawn).not.toHaveBeenCalled();
    });
});
