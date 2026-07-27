import type { FileSystem, ShellRunner } from "./types.js";
import { findDiscordProcesses } from "./discord.js";

// ─── Launch Planning ──────────────────────────────────────────────────────────

export type Platform = "linux" | "darwin" | "win32";

export interface LaunchPlan {
    command: string;
    args: string[];
    /** Variables to strip from the child environment (see SpawnOptions.unsetEnv). */
    unsetEnv: string[];
    /** Variables to add, borrowed from the desktop session when ours has no display. */
    env: Record<string, string>;
    /** Non-null when the environment cannot start a GUI app at all. */
    problem: string | null;
    /** Human-readable note about display handling, for verbose output. */
    note: string | null;
}

/** Variables that decide which display server a GUI app talks to. */
export const SESSION_ENV_KEYS = [
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "DBUS_SESSION_BUS_ADDRESS",
] as const;

/**
 * Decide how to launch Discord for the current platform and environment.
 *
 * Pure so it can be unit-tested for every platform without spawning anything.
 *
 * The Linux branch exists because agents and CI shells frequently inherit a
 * *broken* display environment rather than none at all — most commonly
 * `DISPLAY=""`, which Electron reads as "use X11" and then aborts with
 * "Missing X server or $DISPLAY" about a second after spawn. The old code
 * spawned regardless and reported success, so the caller believed Discord had
 * restarted when it had already exited.
 *
 * The fix is to *borrow the desktop session's own environment* (see
 * `readSessionEnv`) rather than to guess backend flags. Forcing
 * `--ozone-platform=wayland` on a session whose Electron apps run under
 * Xwayland produces a GPU-process crash loop: the window appears, the renderer
 * dies with SIGSEGV, and Discord hangs on "Starting...". Passing the session's
 * real DISPLAY/WAYLAND_DISPLAY/XAUTHORITY makes the launch identical to one
 * started from the desktop, which is the only reliably correct behaviour.
 */
export function resolveLaunchPlan(
    platform: Platform,
    env: Record<string, string | undefined>,
    binary: string,
    sessionEnv?: Record<string, string>,
): LaunchPlan {
    const plan: LaunchPlan = { command: binary, args: [], unsetEnv: [], env: {}, problem: null, note: null };

    if (platform === "win32") {
        // No display negotiation on Windows; the shell spawns into the user session.
        return plan;
    }

    if (platform === "darwin") {
        // Launching the Mach-O binary directly from a non-GUI session (ssh, cron,
        // an agent harness) gives a process with no WindowServer connection. `open`
        // hands the request to launchd, which starts it in the user's GUI session.
        const bundle = appBundlePath(binary);
        if (bundle) {
            return { command: "open", args: ["-a", bundle], unsetEnv: [], env: {}, problem: null, note: `via open -a ${bundle}` };
        }
        return plan;
    }

    // ─── Linux ───
    // Only an X display in our *own* environment is trustworthy. A leftover
    // WAYLAND_DISPLAY is not: agent and service shells routinely inherit one
    // while the desktop session actually runs its apps on Xwayland (DISPLAY=:1).
    // Acting on the stale variable is what forced the Wayland backend and
    // crash-looped Discord's GPU process.
    if (nonEmpty(env["DISPLAY"])) return plan;

    if (sessionEnv) {
        for (const key of SESSION_ENV_KEYS) {
            const value = sessionEnv[key];
            if (value) plan.env[key] = value;
        }

        if (nonEmpty(plan.env["DISPLAY"])) {
            plan.note = `using desktop session display (${plan.env["DISPLAY"]})`;
            return plan;
        }

        // A Wayland-only session: no X server exists to fall back to, so let
        // Chromium pick the backend rather than forcing one.
        if (nonEmpty(plan.env["WAYLAND_DISPLAY"]) && nonEmpty(plan.env["XDG_RUNTIME_DIR"])) {
            plan.args.push("--ozone-platform-hint=auto");
            if (env["DISPLAY"] !== undefined) plan.unsetEnv.push("DISPLAY");
            plan.note = `using desktop session Wayland socket (${plan.env["WAYLAND_DISPLAY"]})`;
            return plan;
        }

        plan.env = {};
    }

    plan.problem =
        "No usable display: this shell has no DISPLAY or WAYLAND_DISPLAY, and none could be " +
        "read from the desktop session (systemctl --user show-environment). " +
        "Discord cannot be started from here — launch it from the desktop session.";
    return plan;
}

function nonEmpty(value: string | undefined): boolean {
    return typeof value === "string" && value.trim() !== "";
}

/**
 * Read the desktop session's environment from the systemd user manager.
 *
 * This is where a graphical session publishes DISPLAY/WAYLAND_DISPLAY (the
 * desktop calls `systemctl --user import-environment` at login), so it is the
 * one place a detached shell can learn how to reach the user's screen.
 * Returns an empty object when systemd is unavailable — e.g. non-systemd
 * Linux, macOS, or Windows — leaving the caller to report a clear failure.
 */
export async function readSessionEnv(shell: ShellRunner): Promise<Record<string, string>> {
    let result: { stdout: string; exitCode: number };
    try {
        result = await shell.exec("systemctl", ["--user", "show-environment"]);
    } catch {
        return {};
    }
    if (result.exitCode !== 0) return {};

    const env: Record<string, string> = {};
    for (const line of result.stdout.split("\n")) {
        const idx = line.indexOf("=");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        if (!(SESSION_ENV_KEYS as readonly string[]).includes(key)) continue;
        // systemd quotes values that need it: DISPLAY=:1 or XAUTHORITY="/path with space"
        let value = line.slice(idx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        env[key] = value;
    }
    return env;
}

/** `/Applications/Discord.app/Contents/MacOS/Discord` → `/Applications/Discord.app` */
function appBundlePath(binary: string): string | null {
    const idx = binary.indexOf(".app/Contents/MacOS/");
    return idx === -1 ? null : binary.slice(0, idx + 4);
}

// ─── Verified Launch ──────────────────────────────────────────────────────────

export interface LaunchVerification {
    /** Discord was observed alive and still alive after the settle window. */
    verified: boolean;
    pids: number[];
    /** Set when verification could not be performed (never used to mask a failure). */
    skippedReason?: string;
}

export interface LaunchOptions {
    platform?: Platform;
    env?: Record<string, string | undefined>;
    /** How long to wait for the process to appear. */
    startupTimeoutMs?: number;
    /** How long it must then stay alive to count as a real start. */
    settleMs?: number;
    /** Where the child's output is appended, for diagnosing a failed start. */
    logFile?: string;
}

const DEFAULT_STARTUP_TIMEOUT = 20_000;
const DEFAULT_SETTLE = 4_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Spawn Discord and prove it actually started.
 *
 * "Started" means: a Discord process appeared within `startupTimeoutMs` **and**
 * was still alive `settleMs` later. The settle window is what catches the
 * common failure — Electron exiting seconds after spawn over a bad display,
 * a missing library, or a corrupt install.
 *
 * Throws with the tail of the launch log when the process never appears or
 * dies during the settle window.
 */
export async function launchDiscordVerified(
    fs: FileSystem,
    shell: ShellRunner,
    binary: string,
    options: LaunchOptions = {},
): Promise<LaunchVerification> {
    const platform = options.platform ?? (process.platform as Platform);
    const env = options.env ?? process.env;
    const startupTimeout = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT;
    const settleMs = options.settleMs ?? DEFAULT_SETTLE;

    // Only consult systemd when our own environment has no X display to use.
    let plan = resolveLaunchPlan(platform, env, binary);
    if (platform === "linux" && !nonEmpty(env["DISPLAY"])) {
        plan = resolveLaunchPlan(platform, env, binary, await readSessionEnv(shell));
    }
    if (plan.problem) throw new Error(plan.problem);

    await shell.spawn(plan.command, plan.args, {
        detached: true,
        env: Object.keys(plan.env).length > 0 ? plan.env : undefined,
        unsetEnv: plan.unsetEnv,
        logFile: options.logFile,
    });

    // Phase 1 — wait for the process to appear.
    const deadline = Date.now() + startupTimeout;
    let pids: number[] = [];
    while (Date.now() < deadline) {
        pids = (await findDiscordProcesses(fs, shell, binary, platform)).map(p => p.pid);
        if (pids.length > 0) break;
        await sleep(250);
    }

    if (pids.length === 0) {
        throw new Error(
            `Discord did not start within ${Math.round(startupTimeout / 1000)}s.` +
            (await logTail(fs, options.logFile))
        );
    }

    // Phase 2 — it must survive the settle window, not just appear.
    await sleep(settleMs);
    const alive = (await findDiscordProcesses(fs, shell, binary, platform)).map(p => p.pid);
    if (alive.length === 0) {
        throw new Error(
            `Discord started (PID ${pids.join(", ")}) but exited within ${Math.round(settleMs / 1000)}s.` +
            (await logTail(fs, options.logFile))
        );
    }

    return { verified: true, pids: alive };
}

async function logTail(fs: FileSystem, logFile?: string): Promise<string> {
    if (!logFile) return "";
    try {
        const content = await fs.readFile(logFile, "utf8");
        const tail = content.trimEnd().split("\n").slice(-8).join("\n");
        return tail ? `\nLaunch log (${logFile}):\n${tail}` : "";
    } catch {
        return "";
    }
}
