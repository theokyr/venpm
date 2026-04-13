import { homedir } from "node:os";
import { join } from "node:path";
import type { FileSystem, ShellRunner } from "./types.js";
import { killDiscordProcesses } from "./discord.js";

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
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Run `pnpm build` inside `vencordPath`.
 * Throws an error if the build exits with a non-zero code.
 */
export async function buildVencord(shell: ShellRunner, vencordPath: string): Promise<void> {
    const result = await shell.exec("pnpm", ["build"], { cwd: vencordPath });
    if (result.exitCode !== 0) {
        throw new Error(
            `pnpm build failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`
        );
    }
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

/**
 * Copy `<vencordPath>/dist/` to the platform-specific deployed location.
 * Skips silently when the deployed directory does not exist on disk.
 */
export async function deployDist(fs: FileSystem, vencordPath: string): Promise<DeployResult> {
    const platform = process.platform as "linux" | "darwin" | "win32";
    const deployPath = DEPLOY_PATHS[platform] ?? DEPLOY_PATHS.linux;

    const deployedDirExists = await fs.exists(deployPath);
    if (!deployedDirExists) {
        return { deployed: false, restarted: false };
    }

    const srcDist = join(vencordPath, "dist");
    await fs.copyDir(srcDist, deployPath);

    return { deployed: true, deployPath, restarted: false };
}

// ─── Restart ──────────────────────────────────────────────────────────────────

/**
 * Kill all running Discord processes, wait for confirmed exit, then spawn
 * the binary detached.  Uses `/proc/<pid>/exe`-based discovery so only
 * verified Discord binaries are killed (no stray processes).  SIGTERM is
 * tried first; survivors are escalated to SIGKILL.
 */
export async function restartDiscord(fs: FileSystem, shell: ShellRunner, discordBinary: string): Promise<void> {
    await killDiscordProcesses(fs, shell, discordBinary);
    await shell.spawn(discordBinary, [], { detached: true });
}

// ─── Orchestrate ──────────────────────────────────────────────────────────────

export interface BuildAndDeployOptions {
    restart?: boolean;
    discordBinary?: string;
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
    await buildVencord(shell, vencordPath);

    const result = await deployDist(fs, vencordPath);

    if (options.restart && options.discordBinary) {
        await restartDiscord(fs, shell, options.discordBinary);
        result.restarted = true;
    }

    return result;
}
