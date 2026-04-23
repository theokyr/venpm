import { describe, it, expect, vi, afterEach } from "vitest";
import {
    isDiscordBinary,
    findDiscordProcesses,
    killDiscordProcesses,
} from "../../src/core/discord.js";
import type { FileSystem, ShellRunner } from "../../src/core/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFsStub(overrides: {
    readdirResult?: string[];
    readlinkMap?: Record<string, string>;
    existsSet?: Set<string>;
} = {}): FileSystem {
    const readlinkMap = overrides.readlinkMap ?? {};
    const existsSet = overrides.existsSet ?? new Set<string>();

    return {
        readdir: vi.fn(async () => overrides.readdirResult ?? []),
        readlink: vi.fn(async (path: string) => {
            if (path in readlinkMap) return readlinkMap[path];
            throw new Error("ENOENT");
        }),
        exists: vi.fn(async (p: string) => existsSet.has(p)),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        rm: vi.fn(),
        symlink: vi.fn(),
        stat: vi.fn(),
        lstat: vi.fn(),
        copyDir: vi.fn(),
    } as unknown as FileSystem;
}

function makeShellStub(execExitCode = 0): ShellRunner {
    return {
        exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: execExitCode })),
        spawn: vi.fn(async () => {}),
    } as unknown as ShellRunner;
}

// ─── isDiscordBinary ─────────────────────────────────────────────────────────

describe("isDiscordBinary", () => {
    it("matches /opt/discord/Discord", () => {
        expect(isDiscordBinary("/opt/discord/Discord")).toBe(true);
    });

    it("matches /opt/discord-canary/DiscordCanary", () => {
        expect(isDiscordBinary("/opt/discord-canary/DiscordCanary")).toBe(true);
    });

    it("matches /opt/Discord/Discord", () => {
        expect(isDiscordBinary("/opt/Discord/Discord")).toBe(true);
    });

    it("matches /usr/bin/discord", () => {
        expect(isDiscordBinary("/usr/bin/discord")).toBe(true);
    });

    it("matches /usr/bin/discord-canary", () => {
        expect(isDiscordBinary("/usr/bin/discord-canary")).toBe(true);
    });

    it("matches /usr/bin/discord-ptb", () => {
        expect(isDiscordBinary("/usr/bin/discord-ptb")).toBe(true);
    });

    it("matches /usr/bin/vesktop", () => {
        expect(isDiscordBinary("/usr/bin/vesktop")).toBe(true);
    });

    it("matches /usr/lib/discord/Discord", () => {
        expect(isDiscordBinary("/usr/lib/discord/Discord")).toBe(true);
    });

    it("matches /usr/share/discord/Discord", () => {
        expect(isDiscordBinary("/usr/share/discord/Discord")).toBe(true);
    });

    it("matches /opt/Vesktop/vesktop", () => {
        expect(isDiscordBinary("/opt/Vesktop/vesktop")).toBe(true);
    });

    it("matches macOS Discord path", () => {
        expect(isDiscordBinary("/Applications/Discord.app/Contents/MacOS/Discord")).toBe(true);
    });

    it("matches macOS Discord Canary path", () => {
        expect(isDiscordBinary("/Applications/Discord Canary.app/Contents/MacOS/Discord Canary")).toBe(true);
    });

    it("matches Flatpak discord path", () => {
        expect(isDiscordBinary("/var/lib/flatpak/app/com.discordapp.Discord/current/active/files/app/bin/Discord")).toBe(true);
    });

    it("matches snap discord path", () => {
        expect(isDiscordBinary("/snap/discord/current/usr/share/discord/Discord")).toBe(true);
    });

    it("rejects unrelated binary", () => {
        expect(isDiscordBinary("/usr/bin/firefox")).toBe(false);
    });

    it("rejects random binary named discord in home dir", () => {
        expect(isDiscordBinary("/home/user/discord")).toBe(false);
    });

    it("rejects /usr/bin/discord-bot (not a real client suffix)", () => {
        expect(isDiscordBinary("/usr/bin/discord-bot")).toBe(false);
    });

    it("rejects /usr/bin/node even if running a discord bot", () => {
        expect(isDiscordBinary("/usr/bin/node")).toBe(false);
    });

    it("matches configured binary exactly", () => {
        expect(isDiscordBinary("/custom/path/my-discord", "/custom/path/my-discord")).toBe(true);
    });

    it("does not match configured binary against different path", () => {
        expect(isDiscordBinary("/usr/bin/firefox", "/custom/path/my-discord")).toBe(false);
    });
});

// ─── findDiscordProcesses ────────────────────────────────────────────────────

describe("findDiscordProcesses", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("finds Discord processes via /proc on Linux", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({
            readdirResult: ["1", "42", "100", "self", "cpuinfo"],
            readlinkMap: {
                "/proc/1/exe": "/usr/lib/systemd/systemd",
                "/proc/42/exe": "/opt/discord/Discord",
                "/proc/100/exe": "/usr/bin/firefox",
            },
        });
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([{ pid: 42, exe: "/opt/discord/Discord" }]);
    });

    it("returns multiple Discord processes", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({
            readdirResult: ["10", "20", "30"],
            readlinkMap: {
                "/proc/10/exe": "/opt/discord/Discord",
                "/proc/20/exe": "/opt/discord/Discord",
                "/proc/30/exe": "/usr/bin/vesktop",
            },
        });
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toHaveLength(3);
        expect(result.map(p => p.pid)).toEqual([10, 20, 30]);
    });

    it("ignores processes where readlink throws (EACCES, ENOENT)", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({
            readdirResult: ["1", "2"],
            readlinkMap: {
                // PID 1 will throw (not in map)
                "/proc/2/exe": "/opt/discord/Discord",
            },
        });
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([{ pid: 2, exe: "/opt/discord/Discord" }]);
    });

    it("returns empty when no Discord processes are running", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({
            readdirResult: ["1", "2", "3"],
            readlinkMap: {
                "/proc/1/exe": "/usr/lib/systemd/systemd",
                "/proc/2/exe": "/usr/bin/firefox",
                "/proc/3/exe": "/usr/bin/node",
            },
        });
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([]);
    });

    it("returns empty when /proc readdir fails", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub();
        (fs.readdir as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ENOENT"));
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([]);
    });

    it("skips non-numeric /proc entries", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({
            readdirResult: ["self", "cpuinfo", "meminfo", "42"],
            readlinkMap: {
                "/proc/42/exe": "/opt/discord/Discord",
            },
        });
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([{ pid: 42, exe: "/opt/discord/Discord" }]);
        expect(fs.readlink).toHaveBeenCalledTimes(1);
    });

    it("includes processes matching configured binary", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({
            readdirResult: ["10"],
            readlinkMap: {
                "/proc/10/exe": "/custom/Discord/discord-custom",
            },
        });
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell, "/custom/Discord/discord-custom");

        expect(result).toEqual([{ pid: 10, exe: "/custom/Discord/discord-custom" }]);
    });

    it("returns empty on unsupported platform", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        const fs = makeFsStub();
        const shell = makeShellStub();

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([]);
    });

    it("finds Discord processes via ps on macOS", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
        const fs = makeFsStub();
        const shell: ShellRunner = {
            exec: vi.fn(async () => ({
                stdout: [
                    "  1 /usr/lib/systemd/systemd",
                    " 42 /Applications/Discord.app/Contents/MacOS/Discord --type=renderer",
                    "100 /usr/bin/firefox",
                ].join("\n"),
                stderr: "",
                exitCode: 0,
            })),
            spawn: vi.fn(async () => {}),
        } as unknown as ShellRunner;

        const result = await findDiscordProcesses(fs, shell);

        expect(result).toEqual([{
            pid: 42,
            exe: "/Applications/Discord.app/Contents/MacOS/Discord",
        }]);
    });
});

// ─── killDiscordProcesses ────────────────────────────────────────────────────

describe("killDiscordProcesses", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("returns empty result when no Discord processes found", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        const fs = makeFsStub({ readdirResult: [] });
        const shell = makeShellStub();

        const result = await killDiscordProcesses(fs, shell);

        expect(result).toEqual({ found: [], killed: [], forced: [] });
        expect(shell.exec).not.toHaveBeenCalled();
    });

    it("sends SIGTERM and reports killed processes", async () => {
        vi.useFakeTimers();
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");

        // Process 42 exists initially, then disappears after SIGTERM
        let killed = false;
        const fs = makeFsStub({
            readdirResult: ["42"],
            readlinkMap: { "/proc/42/exe": "/opt/discord/Discord" },
        });
        (fs.exists as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => {
            if (p === `/proc/42`) return !killed;
            return false;
        });

        const shell = makeShellStub();
        (shell.exec as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
            if (cmd === "kill") killed = true;
            return { stdout: "", stderr: "", exitCode: 0 };
        });

        const promise = killDiscordProcesses(fs, shell);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(shell.exec).toHaveBeenCalledWith("kill", ["-TERM", "42"]);
        expect(result.found).toEqual([{ pid: 42, exe: "/opt/discord/Discord" }]);
        expect(result.killed).toEqual([42]);
        expect(result.forced).toEqual([]);
    });

    it("escalates to SIGKILL when SIGTERM does not work", async () => {
        vi.useFakeTimers();
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");

        // Process survives SIGTERM, dies on SIGKILL
        let sigkillSent = false;
        const fs = makeFsStub({
            readdirResult: ["42"],
            readlinkMap: { "/proc/42/exe": "/opt/discord/Discord" },
        });
        (fs.exists as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => {
            if (p === "/proc/42") return !sigkillSent;
            return false;
        });

        const shell = makeShellStub();
        (shell.exec as ReturnType<typeof vi.fn>).mockImplementation(async (_cmd: string, args: string[]) => {
            if (args[0] === "-KILL") sigkillSent = true;
            return { stdout: "", stderr: "", exitCode: 0 };
        });

        const promise = killDiscordProcesses(fs, shell);
        await vi.runAllTimersAsync();
        const result = await promise;

        // Should have called kill with both -TERM and -KILL
        const killCalls = (shell.exec as ReturnType<typeof vi.fn>).mock.calls
            .filter((c: string[]) => c[0] === "kill");
        expect(killCalls).toHaveLength(2);
        expect(killCalls[0][1]).toEqual(["-TERM", "42"]);
        expect(killCalls[1][1]).toEqual(["-KILL", "42"]);

        expect(result.found).toEqual([{ pid: 42, exe: "/opt/discord/Discord" }]);
        expect(result.forced).toEqual([42]);
    });

    it("handles multiple processes with mixed survival", async () => {
        vi.useFakeTimers();
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");

        // PID 10 dies on SIGTERM, PID 20 survives until SIGKILL
        let pid10Dead = false;
        let pid20Dead = false;
        const fs = makeFsStub({
            readdirResult: ["10", "20"],
            readlinkMap: {
                "/proc/10/exe": "/opt/discord/Discord",
                "/proc/20/exe": "/opt/discord/Discord",
            },
        });
        (fs.exists as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => {
            if (p === "/proc/10") return !pid10Dead;
            if (p === "/proc/20") return !pid20Dead;
            return false;
        });

        const shell = makeShellStub();
        (shell.exec as ReturnType<typeof vi.fn>).mockImplementation(async (_cmd: string, args: string[]) => {
            if (args[0] === "-TERM") pid10Dead = true;
            if (args[0] === "-KILL") pid20Dead = true;
            return { stdout: "", stderr: "", exitCode: 0 };
        });

        const promise = killDiscordProcesses(fs, shell);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.found).toHaveLength(2);
        expect(result.killed).toEqual([10]);
        expect(result.forced).toEqual([20]);
    });

    it("uses taskkill on Windows", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        const fs = makeFsStub();
        const shell = makeShellStub();

        const result = await killDiscordProcesses(fs, shell);

        const taskkillCalls = (shell.exec as ReturnType<typeof vi.fn>).mock.calls
            .filter((c: string[]) => c[0] === "taskkill");
        expect(taskkillCalls.length).toBeGreaterThan(0);
        // Should try known image names
        const imageNames = taskkillCalls.map((c: string[][]) => c[1][2]);
        expect(imageNames).toContain("Discord.exe");
        expect(imageNames).toContain("Vesktop.exe");

        // Win32 returns minimal info since we can't introspect PIDs
        expect(result.found).toEqual([]);
    });
});
