import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { FileSystem, ShellRunner } from "./types.js";

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
        return { deployed: false };
    }

    const srcDist = join(vencordPath, "dist");
    await fs.copyDir(srcDist, deployPath);

    return { deployed: true, deployPath };
}

// ─── Restart ──────────────────────────────────────────────────────────────────

/**
 * Kill Discord via `pkill`, wait briefly, then spawn the binary detached.
 * If pkill reports the process is not running (exit code 1) the kill step is
 * skipped — Discord is still spawned so the caller can open it fresh.
 */
export async function restartDiscord(shell: ShellRunner, discordBinary: string): Promise<void> {
    // pkill returns 0 if at least one process was signalled, 1 if none found.
    // Use -x (exact name match) with basename to avoid matching unrelated processes.
    const processName = basename(discordBinary);
    const killResult = await shell.exec("pkill", ["-x", processName]);
    if (killResult.exitCode !== 0 && killResult.exitCode !== 1) {
        throw new Error(
            `pkill failed (exit ${killResult.exitCode}): ${killResult.stderr}`
        );
    }

    // Give the process a moment to fully exit before relaunching.
    await new Promise<void>(resolve => setTimeout(resolve, 500));

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
        await restartDiscord(shell, options.discordBinary);
    }

    return result;
}
