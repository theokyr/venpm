import { homedir } from "node:os";
import { join } from "node:path";
import type { FileSystem, ShellRunner } from "./types.js";
import { findDiscordProcesses, killDiscordProcesses } from "./discord.js";
import { launchDiscordVerified, type LaunchVerification, type Platform } from "./launch.js";

export interface RestartOptions {
    settleMs?: number;
    startupTimeoutMs?: number;
    logFile?: string;
    /** Overrides for tests and for callers that launch into another session. */
    platform?: Platform;
    env?: Record<string, string | undefined>;
}

/** Where a failed launch leaves its output, so the error can quote it. */
export function getLaunchLogPath(): string {
    const platform = process.platform as "linux" | "darwin" | "win32";
    if (platform === "win32") {
        const base = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
        return join(base, "venpm", "discord-launch.log");
    }
    if (platform === "darwin") {
        return join(homedir(), "Library", "Logs", "venpm", "discord-launch.log");
    }
    const base = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state");
    return join(base, "venpm", "discord-launch.log");
}

// ─── Deploy Paths ─────────────────────────────────────────────────────────────

export const DEPLOY_PATHS: Record<"linux" | "darwin" | "win32", string> = {
    linux: join(homedir(), ".config", "Vencord", "dist"),
    darwin: join(homedir(), "Library", "Application Support", "Vencord", "dist"),
    win32: join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Vencord", "dist"),
};

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface DeployResult {
    deployed: boolean;
    deployPath?: string;
    restarted: boolean;
    /** PIDs of the Discord processes confirmed alive after the restart. */
    restartedPids?: number[];
}

// ─── Build ────────────────────────────────────────────────────────────────────

export interface BuildVencordOptions {
    pnpmEnv?: Record<string, string>;
}

/**
 * Run `pnpm build` inside `vencordPath`.
 * Throws an error if the build exits with a non-zero code.
 */
export async function buildVencord(
    shell: ShellRunner,
    vencordPath: string,
    options: BuildVencordOptions = {}
): Promise<void> {
    const execOptions: { cwd: string; env?: Record<string, string> } = { cwd: vencordPath };
    if (options.pnpmEnv) {
        execOptions.env = options.pnpmEnv;
    }

    const result = await shell.exec("pnpm", ["build"], execOptions);
    if (result.exitCode !== 0) {
        throw new Error(
            `pnpm build failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
        );
    }
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

/**
 * Copy `<vencordPath>/dist/` to the platform-specific deployed location.
 *
 * Creates the deploy directory if it doesn't exist. Previous behaviour was to
 * skip silently when the directory was missing, which required users to run
 * Vencord's own installer first to bootstrap it. On macOS Apple Silicon that
 * installer is x86-only and often fails, so we make `rebuild` self-sufficient.
 */
export async function deployDist(fs: FileSystem, vencordPath: string): Promise<DeployResult> {
    const platform = process.platform as "linux" | "darwin" | "win32";
    const deployPath = DEPLOY_PATHS[platform] ?? DEPLOY_PATHS.linux;

    if (!(await fs.exists(deployPath))) {
        await fs.mkdir(deployPath, { recursive: true });
    }

    const srcDist = join(vencordPath, "dist");
    await fs.copyDir(srcDist, deployPath);

    return { deployed: true, deployPath, restarted: false };
}

// ─── Restart ──────────────────────────────────────────────────────────────────

/**
 * Kill all running Discord processes, wait for confirmed exit, then start the
 * binary again and *prove* it came back.  Uses `/proc/<pid>/exe`-based discovery
 * so only verified Discord binaries are killed (no stray processes).  SIGTERM is
 * tried first; survivors are escalated to SIGKILL.
 *
 * The launch is platform-aware (Wayland/X11 on Linux, `open -a` on macOS) and
 * verified: an exit during the settle window raises an error instead of the
 * caller reporting a restart that never happened.
 */
export async function restartDiscord(
    fs: FileSystem,
    shell: ShellRunner,
    discordBinary: string,
    options: RestartOptions = {},
): Promise<LaunchVerification> {
    await killDiscordProcesses(fs, shell, discordBinary);
    const survivors = await findDiscordProcesses(fs, shell, discordBinary);
    if (survivors.length > 0) {
        const pids = survivors.map(p => p.pid).join(", ");
        throw new Error(`Discord is still running after termination attempt (PID ${pids})`);
    }

    return launchDiscordVerified(fs, shell, discordBinary, {
        settleMs: options.settleMs,
        startupTimeoutMs: options.startupTimeoutMs,
        logFile: options.logFile ?? getLaunchLogPath(),
        platform: options.platform,
        env: options.env,
    });
}

// ─── Orchestrate ──────────────────────────────────────────────────────────────

export interface BuildAndDeployOptions {
    restart?: boolean;
    discordBinary?: string;
    pnpmEnv?: Record<string, string>;
    restartOptions?: RestartOptions;
}

/**
 * Orchestrate build → deploy → (optional) restart.
 */
export async function buildAndDeploy(
    fs: FileSystem,
    shell: ShellRunner,
    vencordPath: string,
    options: BuildAndDeployOptions = {}
): Promise<DeployResult> {
    await buildVencord(shell, vencordPath, { pnpmEnv: options.pnpmEnv });

    const result = await deployDist(fs, vencordPath);

    if (options.restart && options.discordBinary) {
        const verification = await restartDiscord(fs, shell, options.discordBinary, options.restartOptions);
        result.restarted = verification.verified;
        result.restartedPids = verification.pids;
    }

    return result;
}
