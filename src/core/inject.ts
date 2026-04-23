import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createPackage } from "@electron/asar";
import type { FileSystem } from "./types.js";

// ─── Branch definitions ──────────────────────────────────────────────────────

export type DiscordBranch = "stable" | "canary" | "ptb";

export const DISCORD_BRANCHES: DiscordBranch[] = ["stable", "canary", "ptb"];

/**
 * Platform-specific Discord.app paths, keyed by branch.  Only macOS is
 * currently supported by the native inject; Linux and Windows should continue
 * to use Vencord's bundled `pnpm inject`.
 */
const MACOS_BRANCH_PATHS: Record<DiscordBranch, string> = {
    stable: "/Applications/Discord.app",
    canary: "/Applications/Discord Canary.app",
    ptb: "/Applications/Discord PTB.app",
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InjectTarget {
    branch: DiscordBranch;
    appPath: string;
    platform: NodeJS.Platform;
}

export interface InjectStatus {
    injected: boolean;
    /** True when Resources/app.asar exists (either original or our shim). */
    asarPresent: boolean;
    /** True when Resources/_app.asar (Discord's renamed original) exists. */
    backupPresent: boolean;
    /** True when a legacy Resources/app/ directory shim exists. */
    legacyShimDirPresent: boolean;
}

export interface InjectResult {
    branch: DiscordBranch;
    appPath: string;
    shimAsar: string;
    backupPath: string;
}

export class InjectError extends Error {
    constructor(public code: InjectErrorCode, message: string) {
        super(message);
        this.name = "InjectError";
    }
}

export type InjectErrorCode =
    | "PLATFORM_UNSUPPORTED"
    | "DISCORD_NOT_FOUND"
    | "ALREADY_INJECTED"
    | "NOT_INJECTED"
    | "INJECT_FAILED";

// ─── Path helpers ────────────────────────────────────────────────────────────

/**
 * Filesystem layout inside Discord.app on macOS (asar-shim mode):
 *   Contents/Resources/app.asar   — OUR shim, packed as an asar
 *   Contents/Resources/_app.asar  — Discord's original, renamed
 *
 * Electron prefers app.asar over app/, so the shim must be packed as an asar
 * file for Electron to load it. When the shim runs, `require.main.path` ends
 * with `app.asar`, which Vencord's patcher detects (see src/main/patcher.ts
 * line 32) to resolve the original at `_app.asar` and load it.
 *
 * An earlier implementation used a plain `app/` directory alongside
 * `app.asar`. That appeared to work — the shim files existed, uninject could
 * roll back — but Electron silently ignored the directory because app.asar
 * took precedence, so Vencord never actually loaded. Confirmed empirically:
 * moving app.asar aside made the directory-shim load.
 */
function macosPaths(appPath: string) {
    const resources = join(appPath, "Contents", "Resources");
    return {
        resources,
        /** Post-inject: OUR shim asar (pre-inject: Discord's original). */
        asar: join(resources, "app.asar"),
        /** Post-inject: Discord's original asar, renamed. */
        backup: join(resources, "_app.asar"),
        /** Legacy plain-directory shim path — cleaned up if found. */
        legacyShimDir: join(resources, "app"),
    };
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Discover installed Discord branches on the current platform.
 *
 * On unsupported platforms, returns an empty array.  Callers should treat
 * that as "not supported" rather than "none installed".
 */
export async function detectDiscordApps(
    fs: FileSystem,
    platform: NodeJS.Platform = process.platform,
): Promise<InjectTarget[]> {
    if (platform !== "darwin") return [];

    const found: InjectTarget[] = [];
    for (const branch of DISCORD_BRANCHES) {
        const appPath = MACOS_BRANCH_PATHS[branch];
        if (await fs.exists(appPath)) {
            found.push({ branch, appPath, platform });
        }
    }
    return found;
}

/**
 * Inspect an on-disk Discord.app and report injection status.  Does not
 * modify anything.  Returns a detailed breakdown so callers can decide
 * whether to re-inject, warn, or abort.
 */
export async function getInjectStatus(
    fs: FileSystem,
    target: InjectTarget,
): Promise<InjectStatus> {
    if (target.platform !== "darwin") {
        throw new InjectError(
            "PLATFORM_UNSUPPORTED",
            `Native inject is not supported on ${target.platform}`,
        );
    }

    const p = macosPaths(target.appPath);
    const [asarPresent, backupPresent, legacyShimDirPresent] = await Promise.all([
        fs.exists(p.asar),
        fs.exists(p.backup),
        fs.exists(p.legacyShimDir),
    ]);

    // Injected iff both the shim asar (at p.asar) and the backup exist.
    // A bare backup without a shim asar is a broken state (orphan).
    const injected = asarPresent && backupPresent;

    return { injected, asarPresent, backupPresent, legacyShimDirPresent };
}

// ─── Inject / uninject ───────────────────────────────────────────────────────

/**
 * Contents of the shim's package.json — points Electron at index.js.
 */
function shimPackageJson(): string {
    return JSON.stringify({ name: "discord", main: "index.js" }, null, 2) + "\n";
}

/**
 * Contents of the shim's index.js. When this runs, `require.main.path` ends
 * with `app.asar`, so Vencord's patcher (see Vencord src/main/patcher.ts) sets
 * asarName = "_app.asar" and loads Discord's renamed original itself. This
 * file does not need to chain to _app.asar manually.
 */
function shimIndexJs(): string {
    return `// Generated by venpm inject — do not edit.
const { join } = require("path");
const { homedir } = require("os");
const vencordDist = join(homedir(), "Library", "Application Support", "Vencord", "dist", "patcher.js");
require(vencordDist);
`;
}

/**
 * Build a shim asar containing package.json + index.js under a temp dir,
 * then pack it to `destAsar`. Cleans up the temp dir regardless of outcome.
 *
 * @electron/asar's createPackage operates on a source directory, so we
 * materialise the two shim files to a temp dir first rather than using
 * the stream API (simpler, no byte-counting gymnastics).
 */
async function packShimAsar(destAsar: string): Promise<void> {
    const tmp = await mkdtemp(join(tmpdir(), "venpm-inject-"));
    try {
        await writeFile(join(tmp, "package.json"), shimPackageJson(), "utf8");
        await writeFile(join(tmp, "index.js"), shimIndexJs(), "utf8");
        await createPackage(tmp, destAsar);
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
}

/**
 * Patch a Discord.app so Electron loads Vencord's patcher before the
 * original asar. Uses the asar-shim layout:
 *
 *   1. Rename Discord's app.asar → _app.asar
 *   2. Pack a shim asar (package.json + index.js) and place it at app.asar
 *
 * Also cleans up legacy plain-directory shims from older venpm versions.
 *
 * On failure during shim packing, the rename is rolled back so the next
 * Discord launch reverts cleanly to stock behaviour.
 */
export async function injectVencord(
    fs: FileSystem,
    target: InjectTarget,
): Promise<InjectResult> {
    if (target.platform !== "darwin") {
        throw new InjectError(
            "PLATFORM_UNSUPPORTED",
            `Native inject is not supported on ${target.platform}`,
        );
    }

    const p = macosPaths(target.appPath);

    if (!(await fs.exists(target.appPath))) {
        throw new InjectError(
            "DISCORD_NOT_FOUND",
            `Discord.app not found at ${target.appPath}`,
        );
    }

    const status = await getInjectStatus(fs, target);
    if (status.injected) {
        throw new InjectError(
            "ALREADY_INJECTED",
            `Discord at ${target.appPath} is already injected`,
        );
    }

    // Clean up any legacy plain-directory shim so Electron doesn't get
    // confused if something leaves one behind.
    if (status.legacyShimDirPresent) {
        await fs.rm(p.legacyShimDir, { recursive: true, force: true });
    }

    if (!status.asarPresent) {
        throw new InjectError(
            "INJECT_FAILED",
            `Missing ${p.asar} — Discord install appears incomplete`,
        );
    }

    // Rename original out of the way. If a stale _app.asar is lingering,
    // remove it first so rename doesn't collide.
    if (status.backupPresent) {
        await fs.rm(p.backup, { force: true });
    }
    await fs.rename(p.asar, p.backup);

    try {
        await packShimAsar(p.asar);
    } catch (err) {
        // Roll back rename so Discord still launches stock.
        try {
            if (!(await fs.exists(p.asar)) && await fs.exists(p.backup)) {
                await fs.rename(p.backup, p.asar);
            }
        } catch {
            // Swallow — surface the original error.
        }
        throw new InjectError(
            "INJECT_FAILED",
            `Shim asar packing failed: ${(err as Error).message}`,
        );
    }

    return {
        branch: target.branch,
        appPath: target.appPath,
        shimAsar: p.asar,
        backupPath: p.backup,
    };
}

/**
 * Reverse an inject: remove the shim asar, rename backup back to app.asar.
 * Also cleans up any legacy plain-directory shim.
 */
export async function uninjectVencord(
    fs: FileSystem,
    target: InjectTarget,
): Promise<InjectResult> {
    if (target.platform !== "darwin") {
        throw new InjectError(
            "PLATFORM_UNSUPPORTED",
            `Native uninject is not supported on ${target.platform}`,
        );
    }

    const p = macosPaths(target.appPath);
    const status = await getInjectStatus(fs, target);

    if (!status.injected && !status.legacyShimDirPresent && !status.backupPresent) {
        throw new InjectError(
            "NOT_INJECTED",
            `Discord at ${target.appPath} is not injected`,
        );
    }

    // Clean up a legacy directory shim if one lingers.
    if (status.legacyShimDirPresent) {
        await fs.rm(p.legacyShimDir, { recursive: true, force: true });
    }

    // Remove our shim asar (identified by presence of a backup).
    if (status.asarPresent && status.backupPresent) {
        await fs.rm(p.asar, { force: true });
    }

    // Restore the original.
    if (status.backupPresent) {
        await fs.rename(p.backup, p.asar);
    }

    return {
        branch: target.branch,
        appPath: target.appPath,
        shimAsar: p.asar,
        backupPath: p.backup,
    };
}
