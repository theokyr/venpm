import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { createPackage, extractFile, listPackage } from "@electron/asar";
import {
    DISCORD_BRANCHES,
    detectDiscordApps,
    getInjectStatus,
    injectVencord,
    uninjectVencord,
    InjectError,
    type InjectTarget,
} from "../../src/core/inject.js";
import type { FileSystem } from "../../src/core/types.js";

// ─── Test helpers ────────────────────────────────────────────────────────────
//
// The inject flow uses the real `node:fs/promises` to materialise shim files
// into a tmp dir and then calls `@electron/asar.createPackage` on it.  That
// part is exercised via the integration-style test at the bottom of this file
// (which uses a real tmp dir).  For status / error-path coverage we use the
// FileSystem stub below — it doesn't need to model the tmp-dir write.

function makeFs(existing: Set<string>): FileSystem {
    const renames: Array<[string, string]> = [];
    const rms: string[] = [];

    const fs: FileSystem = {
        exists: vi.fn(async (p: string) => existing.has(p)),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(async (p: string) => {
            existing.add(p);
        }),
        rm: vi.fn(async (p: string) => {
            rms.push(p);
            existing.delete(p);
        }),
        symlink: vi.fn(),
        readlink: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
        lstat: vi.fn(),
        copyDir: vi.fn(),
        rename: vi.fn(async (src: string, dest: string) => {
            renames.push([src, dest]);
            if (existing.has(src)) {
                existing.delete(src);
                existing.add(dest);
            }
        }),
    };

    (fs as unknown as { _renames: typeof renames })._renames = renames;
    (fs as unknown as { _rms: typeof rms })._rms = rms;
    return fs;
}

const STABLE_APP = "/Applications/Discord.app";
const CANARY_APP = "/Applications/Discord Canary.app";
const PTB_APP = "/Applications/Discord PTB.app";

function stablePaths() {
    const r = `${STABLE_APP}/Contents/Resources`;
    return {
        app: STABLE_APP,
        resources: r,
        asar: `${r}/app.asar`,
        backup: `${r}/_app.asar`,
        legacyShimDir: `${r}/app`,
    };
}

const DARWIN_TARGET: InjectTarget = {
    branch: "stable",
    appPath: STABLE_APP,
    platform: "darwin",
};

const LINUX_TARGET: InjectTarget = {
    branch: "stable",
    appPath: "/opt/discord",
    platform: "linux",
};

// ─── Branch constant ─────────────────────────────────────────────────────────

describe("DISCORD_BRANCHES", () => {
    it("contains the three canonical branches", () => {
        expect(DISCORD_BRANCHES).toEqual(["stable", "canary", "ptb"]);
    });
});

// ─── detectDiscordApps ───────────────────────────────────────────────────────

describe("detectDiscordApps", () => {
    it("returns empty array on win32 platforms", async () => {
        const fs = makeFs(new Set([STABLE_APP, CANARY_APP]));
        expect(await detectDiscordApps(fs, "win32")).toEqual([]);
    });

    it("returns Linux Discord installs from standard package paths", async () => {
        const fs = makeFs(new Set(["/opt/discord", "/opt/discord-canary"]));
        const apps = await detectDiscordApps(fs, "linux");

        expect(apps).toEqual([
            { branch: "stable", appPath: "/opt/discord", platform: "linux" },
            { branch: "canary", appPath: "/opt/discord-canary", platform: "linux" },
        ]);
    });

    it("returns only branches whose .app exists", async () => {
        const fs = makeFs(new Set([STABLE_APP, PTB_APP]));
        const apps = await detectDiscordApps(fs, "darwin");
        expect(apps.map(a => a.branch)).toEqual(["stable", "ptb"]);
        expect(apps.every(a => a.platform === "darwin")).toBe(true);
    });

    it("returns empty array when no Discord installed", async () => {
        const fs = makeFs(new Set());
        expect(await detectDiscordApps(fs, "darwin")).toEqual([]);
    });
});

// ─── getInjectStatus ─────────────────────────────────────────────────────────

describe("getInjectStatus", () => {
    it("reports not-injected for fresh Discord.app", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar]));
        const status = await getInjectStatus(fs, DARWIN_TARGET);
        expect(status).toEqual({
            injected: false,
            asarPresent: true,
            backupPresent: false,
            legacyShimDirPresent: false,
        });
    });

    it("does not treat mere app.asar plus backup presence as injected", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar, p.backup]));
        const status = await getInjectStatus(fs, DARWIN_TARGET);
        expect(status.injected).toBe(false);
    });

    it("reports not-injected for bare backup without shim asar (orphan)", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.backup]));
        const status = await getInjectStatus(fs, DARWIN_TARGET);
        expect(status.injected).toBe(false);
        expect(status.backupPresent).toBe(true);
        expect(status.asarPresent).toBe(false);
    });

    it("flags a lingering legacy app/ directory", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar, p.legacyShimDir]));
        const status = await getInjectStatus(fs, DARWIN_TARGET);
        expect(status.legacyShimDirPresent).toBe(true);
    });

    it("reports not-injected for fresh Linux Discord install", async () => {
        const fs = makeFs(new Set(["/opt/discord", "/opt/discord/resources/app.asar"]));
        const status = await getInjectStatus(fs, LINUX_TARGET);

        expect(status).toEqual({
            injected: false,
            asarPresent: true,
            backupPresent: false,
            legacyShimDirPresent: false,
        });
    });

    it("throws PLATFORM_UNSUPPORTED on unsupported platforms", async () => {
        const fs = makeFs(new Set());
        const target = { ...DARWIN_TARGET, platform: "win32" as NodeJS.Platform };
        await expect(getInjectStatus(fs, target)).rejects.toMatchObject({
            code: "PLATFORM_UNSUPPORTED",
        });
    });
});

// ─── injectVencord (error paths + legacy handling) ───────────────────────────

describe("injectVencord error paths", () => {
    it("throws INJECT_FAILED when the shim cannot be packed", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar, p.backup]));
        await expect(injectVencord(fs, DARWIN_TARGET)).rejects.toMatchObject({
            code: "INJECT_FAILED",
        });
    });

    it("throws DISCORD_NOT_FOUND when .app missing", async () => {
        const fs = makeFs(new Set());
        await expect(injectVencord(fs, DARWIN_TARGET)).rejects.toMatchObject({
            code: "DISCORD_NOT_FOUND",
        });
    });

    it("throws INJECT_FAILED when app.asar missing (broken install)", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app])); // no asar at all
        await expect(injectVencord(fs, DARWIN_TARGET)).rejects.toMatchObject({
            code: "INJECT_FAILED",
        });
    });

    it("throws PLATFORM_UNSUPPORTED on unsupported target", async () => {
        const fs = makeFs(new Set());
        const target: InjectTarget = { ...DARWIN_TARGET, platform: "win32" };
        await expect(injectVencord(fs, target)).rejects.toMatchObject({
            code: "PLATFORM_UNSUPPORTED",
        });
    });
});

// ─── uninjectVencord ─────────────────────────────────────────────────────────

describe("uninjectVencord", () => {
    it("throws NOT_INJECTED for stock app.asar with a stale backup", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar, p.backup]));
        await expect(uninjectVencord(fs, DARWIN_TARGET)).rejects.toMatchObject({
            code: "NOT_INJECTED",
        });
    });

    it("removes a legacy app/ directory when only that is present", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar, p.legacyShimDir]));
        await uninjectVencord(fs, DARWIN_TARGET);

        const rms = (fs as unknown as { _rms: string[] })._rms;
        expect(rms).toContain(p.legacyShimDir);
    });

    it("recovers from bare-backup orphan by restoring asar", async () => {
        const p = stablePaths();
        // Orphan state: backup exists but no shim asar at app.asar
        const fs = makeFs(new Set([p.app, p.backup]));
        await uninjectVencord(fs, DARWIN_TARGET);

        const renames = (fs as unknown as { _renames: Array<[string, string]> })._renames;
        expect(renames).toContainEqual([p.backup, p.asar]);
    });

    it("throws NOT_INJECTED when Discord is clean", async () => {
        const p = stablePaths();
        const fs = makeFs(new Set([p.app, p.asar]));
        await expect(uninjectVencord(fs, DARWIN_TARGET)).rejects.toMatchObject({
            code: "NOT_INJECTED",
        });
    });

    it("throws PLATFORM_UNSUPPORTED on unsupported target", async () => {
        const fs = makeFs(new Set());
        const target: InjectTarget = { ...DARWIN_TARGET, platform: "win32" };
        await expect(uninjectVencord(fs, target)).rejects.toBeInstanceOf(InjectError);
    });
});

// ─── Integration: real asar pack ─────────────────────────────────────────────
//
// Exercises the full inject happy path against the real filesystem to verify:
//   - Original asar gets renamed to _app.asar
//   - A valid asar file is produced at app.asar
//   - Header lists package.json + index.js
//   - Uninject reverses it cleanly
//
// Uses real temp files so we can verify the generated asar contents.

describe("injectVencord (integration)", () => {
    let tmpRoot: string;
    let fakeApp: string;
    let fakeResources: string;

    beforeEach(async () => {
        tmpRoot = await fsPromises.mkdtemp(join(os.tmpdir(), "venpm-inject-it-"));
        fakeApp = join(tmpRoot, "Discord.app");
        fakeResources = join(fakeApp, "Contents", "Resources");
        await fsPromises.mkdir(fakeResources, { recursive: true });
        // A valid asar file is not strictly required for the rename step, but
        // using any byte content makes sure the backup path exercises I/O.
        await fsPromises.writeFile(join(fakeResources, "app.asar"), "pretend-asar-bytes");
    });

    afterEach(async () => {
        await fsPromises.rm(tmpRoot, { recursive: true, force: true });
    });

    // Inject operates on real fs via a wrapper FileSystem. We use the same stub
    // shape as realIOContext — simpler to hand-roll here than import the CLI.
    function realFs(): FileSystem {
        return {
            readFile: (p, enc) => fsPromises.readFile(p, { encoding: enc }),
            writeFile: (p, d, enc) => fsPromises.writeFile(p, d, { encoding: enc ?? "utf8" }),
            exists: async p => {
                try { await fsPromises.access(p); return true; } catch { return false; }
            },
            mkdir: (p, o) => fsPromises.mkdir(p, o).then(() => undefined),
            rm: (p, o) => fsPromises.rm(p, o),
            symlink: (t, p) => fsPromises.symlink(t, p),
            readlink: p => fsPromises.readlink(p),
            readdir: p => fsPromises.readdir(p),
            stat: p => fsPromises.stat(p),
            lstat: p => fsPromises.lstat(p),
            copyDir: (s, d) => fsPromises.cp(s, d, { recursive: true }),
            rename: (s, d) => fsPromises.rename(s, d),
        };
    }

    it("packs a real asar and round-trips through uninject on macOS layout", async () => {
        const fs = realFs();
        const target: InjectTarget = {
            branch: "stable",
            appPath: fakeApp,
            platform: "darwin",
        };

        await injectVencord(fs, target);

        await expect(injectVencord(fs, target)).rejects.toMatchObject({
            code: "ALREADY_INJECTED",
        });

        // After inject: original is at _app.asar, shim at app.asar
        expect(await fs.exists(join(fakeResources, "_app.asar"))).toBe(true);
        expect(await fs.exists(join(fakeResources, "app.asar"))).toBe(true);
        expect((await getInjectStatus(fs, target)).injected).toBe(true);

        // The new asar must be a real asar containing our two shim files.
        const entries = listPackage(join(fakeResources, "app.asar"), {});
        expect(entries).toContain("/package.json");
        expect(entries).toContain("/index.js");

        // Backup must still hold the original bytes.
        const backupBytes = await fsPromises.readFile(join(fakeResources, "_app.asar"), "utf8");
        expect(backupBytes).toBe("pretend-asar-bytes");

        await uninjectVencord(fs, target);

        // After uninject: asar restored, no backup.
        expect(await fs.exists(join(fakeResources, "_app.asar"))).toBe(false);
        const restored = await fsPromises.readFile(join(fakeResources, "app.asar"), "utf8");
        expect(restored).toBe("pretend-asar-bytes");
    });

    it("packs a Linux shim that points at the Linux Vencord dist path", async () => {
        const fs = realFs();
        fakeApp = join(tmpRoot, "discord");
        fakeResources = join(fakeApp, "resources");
        await fsPromises.mkdir(fakeResources, { recursive: true });
        await fsPromises.writeFile(join(fakeResources, "app.asar"), "pretend-asar-bytes");

        const target: InjectTarget = {
            branch: "stable",
            appPath: fakeApp,
            platform: "linux",
        };

        await injectVencord(fs, target);

        const indexJs = extractFile(join(fakeResources, "app.asar"), "index.js").toString();
        expect(indexJs).toContain('".config", "Vencord", "dist", "patcher.js"');
        expect(await fs.exists(join(fakeResources, "_app.asar"))).toBe(true);
    });

    it("does not treat a stock app.asar plus stale backup as injected", async () => {
        const fs = realFs();
        fakeApp = join(tmpRoot, "discord");
        fakeResources = join(fakeApp, "resources");
        await fsPromises.mkdir(fakeResources, { recursive: true });

        const stockSrc = join(tmpRoot, "stock-src");
        await fsPromises.mkdir(join(stockSrc, "app_bootstrap"), { recursive: true });
        await fsPromises.writeFile(
            join(stockSrc, "package.json"),
            JSON.stringify({ name: "discord", main: "app_bootstrap/index.js" }),
            "utf8",
        );
        await fsPromises.writeFile(join(stockSrc, "app_bootstrap", "index.js"), "", "utf8");
        await createPackage(stockSrc, join(fakeResources, "app.asar"));
        await createPackage(stockSrc, join(fakeResources, "_app.asar"));

        const target: InjectTarget = {
            branch: "stable",
            appPath: fakeApp,
            platform: "linux",
        };

        const status = await getInjectStatus(fs, target);

        expect(status.injected).toBe(false);
        expect(status.backupPresent).toBe(true);
        expect(status.asarPresent).toBe(true);
    });
});
