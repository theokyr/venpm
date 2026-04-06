import { homedir } from "node:os";
import { join } from "node:path";
import type { FileSystem, ShellRunner } from "./types.js";

export const VENCORD_SEARCH_PATHS: string[] = [
    "~/src/extern/Vencord",
    "~/Vencord",
    "~/.local/share/Vencord",
    "~/Documents/Vencord",
    "./Vencord",
    "../Vencord",
];

/** Replace a leading `~` with the user's home directory. */
export function resolveTilde(p: string): string {
    if (p.startsWith("~/") || p === "~") {
        return join(homedir(), p.slice(1));
    }
    return p;
}

/**
 * Detect the Vencord source checkout path.
 *
 * Checks `$VENPM_VENCORD_PATH` first, then scans VENCORD_SEARCH_PATHS.
 * A path is valid when `<path>/package.json` exists.
 *
 * @returns Absolute path string or null when not found.
 */
export async function detectVencordPath(fs: FileSystem): Promise<string | null> {
    const envPath = process.env.VENPM_VENCORD_PATH;
    if (envPath) {
        const resolved = resolveTilde(envPath);
        if (await fs.exists(join(resolved, "package.json"))) {
            return resolved;
        }
        // Env var was set but path is invalid — do not fall through to scan.
        return null;
    }

    for (const rawPath of VENCORD_SEARCH_PATHS) {
        const resolved = resolveTilde(rawPath);
        if (await fs.exists(join(resolved, "package.json"))) {
            return resolved;
        }
    }

    return null;
}

/** Platform-specific candidate binary paths for Discord. */
function discordBinaryCandidates(): string[] {
    const platform = process.platform;

    if (platform === "linux") {
        return [
            "/usr/bin/discord",
            "/usr/bin/discord-canary",
            "/usr/bin/vesktop",
        ];
    }

    if (platform === "darwin") {
        return [
            "/Applications/Discord.app/Contents/MacOS/Discord",
            "/Applications/Discord Canary.app/Contents/MacOS/Discord Canary",
        ];
    }

    // Windows and others: skip glob patterns — return empty.
    return [];
}

/**
 * Detect the Discord binary path.
 *
 * Returns the first candidate that exists on disk, or null.
 */
export async function detectDiscordBinary(fs: FileSystem): Promise<string | null> {
    for (const candidate of discordBinaryCandidates()) {
        if (await fs.exists(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Check whether `git` is available on PATH.
 */
export async function checkGitAvailable(shell: ShellRunner): Promise<boolean> {
    try {
        const result = await shell.exec("git", ["--version"]);
        return result.exitCode === 0;
    } catch {
        return false;
    }
}

/**
 * Check whether `pnpm` is available on PATH.
 */
export async function checkPnpmAvailable(shell: ShellRunner): Promise<boolean> {
    try {
        const result = await shell.exec("pnpm", ["--version"]);
        return result.exitCode === 0;
    } catch {
        return false;
    }
}
