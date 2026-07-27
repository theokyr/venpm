import type { FileSystem, ShellRunner } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiscordProcess {
    pid: number;
    exe: string;
}

export interface KillResult {
    found: DiscordProcess[];
    killed: number[];
    forced: number[];
}

// ─── Binary Allowlist ────────────────────────────────────────────────────────

/**
 * Patterns matched against the resolved `/proc/<pid>/exe` path.
 * These target the ACTUAL binaries (not wrapper scripts), since the
 * kernel resolves through symlinks and script interpreters.
 */
const DISCORD_EXE_PATTERNS: RegExp[] = [
    // Standard Linux package installs (/opt/discord/Discord, /opt/discord-canary/DiscordCanary, etc.)
    /^\/opt\/[Dd]iscord[^/]*\/[Dd]iscord/,
    /^\/usr\/lib\/discord[^/]*\/[Dd]iscord/,
    /^\/usr\/share\/discord[^/]*\/[Dd]iscord/,
    // Discord's Linux updater installs into the user's config directory and
    // advances app-* version directories independently of venpm.
    /^\/(?:home|var\/home)\/[^/]+\/\.config\/discord(?:canary|ptb)?\/(?:[Dd]iscord(?:Canary|PTB)?|app-[^/]+\/[Dd]iscord(?:Canary|PTB)?)$/,
    // Vesktop
    /^\/opt\/[Vv]esktop[^/]*\/[Vv]esktop/,
    /^\/usr\/lib\/vesktop[^/]*\/[Vv]esktop/,
    /^\/usr\/share\/vesktop[^/]*\/[Vv]esktop/,
    // Wrapper scripts that are themselves valid executables
    /^\/usr\/bin\/discord(?:-canary|-ptb)?$/,
    /^\/usr\/bin\/vesktop$/,
    // Flatpak
    /\/app\/bin\/[Dd]iscord/,
    /\/app\/bin\/[Vv]esktop/,
    // Snap
    /^\/snap\/discord\//,
    /^\/snap\/vesktop\//,
    // macOS
    /^\/Applications\/Discord[^/]*\.app\/Contents\/MacOS\//,
    /^\/Applications\/Vesktop\.app\/Contents\/MacOS\//,
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesConfiguredUpdaterBinary(resolvedPath: string, configuredBinary: string): boolean {
    const match = configuredBinary.match(/^(.*)\/(Discord(?:Canary|PTB)?)$/);
    if (!match) return false;

    const [, dir, binaryName] = match;
    const appBinaryPattern = new RegExp(
        `^${escapeRegExp(dir)}/app-[^/]+/${escapeRegExp(binaryName)}$`
    );
    return appBinaryPattern.test(resolvedPath);
}

/**
 * Check whether a resolved binary path belongs to a Discord installation.
 * Matches against known install locations + the user's configured binary.
 */
export function isDiscordBinary(resolvedPath: string, configuredBinary?: string | null): boolean {
    if (configuredBinary && resolvedPath === configuredBinary) return true;
    if (configuredBinary && matchesConfiguredUpdaterBinary(resolvedPath, configuredBinary)) return true;
    return DISCORD_EXE_PATTERNS.some(p => p.test(resolvedPath));
}

// ─── Process Discovery ──────────────────────────────────────────────────────

/**
 * Find running Discord processes on Linux by inspecting `/proc/<pid>/exe`.
 * Only returns processes whose binary resolves to a known Discord path.
 *
 * On non-Linux platforms, falls back to `ps` output parsing (macOS) or
 * returns an empty array (Windows — handled separately by the caller).
 */
export async function findDiscordProcesses(
    fs: FileSystem,
    shell: ShellRunner,
    configuredBinary?: string | null,
    /**
     * Which platform's discovery to use. Defaults to the host's, but callers
     * that already resolve a platform must pass it — otherwise a caller
     * targeting Linux silently gets the host's discovery instead, which is
     * how the launch tests hung when run on macOS.
     */
    platform: NodeJS.Platform = process.platform,
): Promise<DiscordProcess[]> {
    if (platform === "linux") {
        return findDiscordProcessesLinux(fs, configuredBinary);
    }
    if (platform === "darwin") {
        return findDiscordProcessesMacOS(shell, configuredBinary);
    }
    if (platform === "win32") {
        return findDiscordProcessesWin32(shell, configuredBinary);
    }
    return [];
}

/**
 * Windows has no /proc and no ps, so liveness comes from `tasklist` CSV output.
 * Image names only — enough to answer "is Discord running?", which is what
 * restart verification needs.
 */
export async function findDiscordProcessesWin32(
    shell: ShellRunner,
    configuredBinary?: string | null,
): Promise<DiscordProcess[]> {
    const imageNames = ["Discord.exe", "DiscordCanary.exe", "DiscordPTB.exe", "Vesktop.exe"];
    const configuredName = configuredBinary?.split(/[/\\]/).pop();
    if (configuredName && !imageNames.includes(configuredName)) imageNames.push(configuredName);

    const processes: DiscordProcess[] = [];
    for (const name of imageNames) {
        const result = await shell.exec("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"]);
        if (result.exitCode !== 0) continue;
        for (const line of result.stdout.split("\n")) {
            // "Discord.exe","1234","Console","1","123,456 K"
            const fields = line.trim().match(/^"([^"]+)","(\d+)"/);
            if (!fields) continue;
            processes.push({ pid: parseInt(fields[2], 10), exe: fields[1] });
        }
    }
    return processes;
}

async function findDiscordProcessesLinux(
    fs: FileSystem,
    configuredBinary?: string | null,
): Promise<DiscordProcess[]> {
    let entries: string[];
    try {
        entries = await fs.readdir("/proc");
    } catch {
        return [];
    }

    const processes: DiscordProcess[] = [];

    for (const entry of entries) {
        const pid = parseInt(entry, 10);
        if (isNaN(pid) || pid <= 0) continue;

        try {
            const exe = await fs.readlink(`/proc/${pid}/exe`);
            if (isDiscordBinary(exe, configuredBinary)) {
                processes.push({ pid, exe });
            }
        } catch {
            // EACCES (other user), ENOENT (process exited), etc. — skip.
            continue;
        }
    }

    return processes;
}

async function findDiscordProcessesMacOS(
    shell: ShellRunner,
    configuredBinary?: string | null,
): Promise<DiscordProcess[]> {
    const result = await shell.exec("ps", ["-eo", "pid=,args="]);
    if (result.exitCode !== 0) return [];

    const processes: DiscordProcess[] = [];
    for (const line of result.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const spaceIdx = trimmed.indexOf(" ");
        if (spaceIdx === -1) continue;
        const pid = parseInt(trimmed.slice(0, spaceIdx), 10);
        if (isNaN(pid)) continue;
        const exe = trimmed.slice(spaceIdx + 1).trim().split(" ")[0];
        if (isDiscordBinary(exe, configuredBinary)) {
            processes.push({ pid, exe });
        }
    }

    return processes;
}

// ─── Process Liveness ────────────────────────────────────────────────────────

async function isProcessAlive(fs: FileSystem, shell: ShellRunner, pid: number): Promise<boolean> {
    if (process.platform === "linux") {
        return fs.exists(`/proc/${pid}`);
    }
    // macOS / others: kill -0 checks existence without sending a signal.
    const result = await shell.exec("kill", ["-0", String(pid)]);
    return result.exitCode === 0;
}

/**
 * Poll until all PIDs have exited, or the timeout expires.
 * Returns PIDs that are still alive after the deadline.
 */
async function waitForExit(
    fs: FileSystem,
    shell: ShellRunner,
    pids: number[],
    timeoutMs: number,
    pollMs: number = 250,
): Promise<number[]> {
    const deadline = Date.now() + timeoutMs;
    let remaining = [...pids];

    while (remaining.length > 0 && Date.now() < deadline) {
        await new Promise<void>(r => setTimeout(r, pollMs));
        const alive: number[] = [];
        for (const pid of remaining) {
            if (await isProcessAlive(fs, shell, pid)) {
                alive.push(pid);
            }
        }
        remaining = alive;
    }

    return remaining;
}

// ─── Kill ────────────────────────────────────────────────────────────────────

/**
 * Kill all running Discord processes with SIGTERM → wait → SIGKILL escalation.
 *
 * 1. Discovers processes via `/proc/<pid>/exe` (Linux) or `ps` (macOS)
 * 2. Sends SIGTERM to all matching PIDs
 * 3. Waits up to 5 s for graceful exit (polling every 250 ms)
 * 4. Sends SIGKILL to any survivors
 * 5. Waits up to 2 s for forced exit
 *
 * On Windows, falls back to `taskkill /F` against the configured binary name.
 */
export async function killDiscordProcesses(
    fs: FileSystem,
    shell: ShellRunner,
    configuredBinary?: string | null,
): Promise<KillResult> {
    // Windows fallback — no /proc, no ps.
    if (process.platform === "win32") {
        return killDiscordProcessesWin32(shell, configuredBinary);
    }

    const found = await findDiscordProcesses(fs, shell, configuredBinary);

    if (found.length === 0) {
        return { found: [], killed: [], forced: [] };
    }

    const pids = found.map(p => p.pid);

    // SIGTERM
    await shell.exec("kill", ["-TERM", ...pids.map(String)]);

    // Wait for graceful shutdown
    const survivorsAfterTerm = await waitForExit(fs, shell, pids, 5000);
    const killed = pids.filter(p => !survivorsAfterTerm.includes(p));

    // SIGKILL survivors
    let forced: number[] = [];
    if (survivorsAfterTerm.length > 0) {
        await shell.exec("kill", ["-KILL", ...survivorsAfterTerm.map(String)]);
        const survivorsAfterKill = await waitForExit(fs, shell, survivorsAfterTerm, 2000);
        forced = survivorsAfterTerm.filter(p => !survivorsAfterKill.includes(p));
    }

    return { found, killed, forced };
}

async function killDiscordProcessesWin32(
    shell: ShellRunner,
    configuredBinary?: string | null,
): Promise<KillResult> {
    // Best-effort: kill known image names.
    const imageNames = ["Discord.exe", "DiscordCanary.exe", "DiscordPTB.exe", "Vesktop.exe"];
    if (configuredBinary) {
        const base = configuredBinary.split(/[/\\]/).pop();
        if (base && !imageNames.includes(base)) {
            imageNames.push(base);
        }
    }

    const found = await findDiscordProcessesWin32(shell, configuredBinary);

    for (const name of imageNames) {
        // taskkill /F /IM — exit 128 means "no such process", which is fine.
        await shell.exec("taskkill", ["/F", "/IM", name]);
    }

    // taskkill /F is already a hard kill, so everything it removed counts as forced.
    const survivors = await findDiscordProcessesWin32(shell, configuredBinary);
    const survivingPids = new Set(survivors.map(p => p.pid));
    return {
        found,
        killed: [],
        forced: found.map(p => p.pid).filter(pid => !survivingPids.has(pid)),
    };
}
