import { describe, it, expect } from "vitest";
import type { FileSystem, InstalledPlugin } from "../../src/core/types.js";
import {
    EMPTY_LOCKFILE,
    loadLockfile,
    saveLockfile,
    isInstalled,
    getInstalled,
    addInstalled,
    removeInstalled,
} from "../../src/core/lockfile.js";

// ─── Mock filesystem ──────────────────────────────────────────────────────────

function makeMockFs(files: Record<string, string> = {}): FileSystem & { written: Record<string, string> } {
    const store = { ...files };
    const written: Record<string, string> = {};
    return {
        written,
        async readFile(path) { return store[path] ?? ""; },
        async writeFile(path, data) { store[path] = data; written[path] = data; },
        async exists(path) { return Object.prototype.hasOwnProperty.call(store, path); },
        async mkdir() {},
        async rm() {},
        async symlink() {},
        async readlink() { return ""; },
        async readdir() { return []; },
        async stat() { return { isDirectory: () => false, isFile: () => true, size: 0 }; },
        async lstat() { return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }; },
        async copyDir() {},
    };
}

// ─── Test data ────────────────────────────────────────────────────────────────

const LOCK_PATH = "/home/user/.config/venpm/venpm-lock.json";

const sampleEntry: InstalledPlugin = {
    version: "1.0.0",
    repo: "kamaras",
    method: "git",
    pinned: false,
    installed_at: "2026-04-06T12:00:00Z",
};

const pinnedEntry: InstalledPlugin = {
    version: "2.0.0",
    repo: "kamaras",
    method: "tarball",
    pinned: true,
    git_ref: "abc1234",
    installed_at: "2026-04-06T13:00:00Z",
    path: "plugins/channelTabs",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EMPTY_LOCKFILE", () => {
    it("has an empty installed record", () => {
        expect(EMPTY_LOCKFILE.installed).toEqual({});
    });
});

describe("loadLockfile", () => {
    it("returns empty lockfile when file does not exist", async () => {
        const fs = makeMockFs();
        const result = await loadLockfile(fs, LOCK_PATH);
        expect(result).toEqual({ installed: {} });
    });

    it("parses an existing lockfile", async () => {
        const data = {
            installed: {
                channelTabs: sampleEntry,
            },
        };
        const fs = makeMockFs({ [LOCK_PATH]: JSON.stringify(data) });
        const result = await loadLockfile(fs, LOCK_PATH);
        expect(result.installed.channelTabs).toEqual(sampleEntry);
    });
});

describe("saveLockfile", () => {
    it("writes formatted JSON with trailing newline", async () => {
        const fs = makeMockFs();
        const data = { installed: { testPlugin: sampleEntry } };
        await saveLockfile(fs, LOCK_PATH, data);
        const written = fs.written[LOCK_PATH];
        expect(written).toBeDefined();
        expect(written).toContain("  "); // pretty-printed
        expect(written.endsWith("\n")).toBe(true);
        expect(JSON.parse(written)).toEqual(data);
    });
});

describe("isInstalled", () => {
    it("returns true when plugin is present", () => {
        const data = { installed: { channelTabs: sampleEntry } };
        expect(isInstalled(data, "channelTabs")).toBe(true);
    });

    it("returns false when plugin is absent", () => {
        const data = { installed: {} };
        expect(isInstalled(data, "channelTabs")).toBe(false);
    });
});

describe("getInstalled", () => {
    it("returns the entry when plugin is present", () => {
        const data = { installed: { channelTabs: sampleEntry } };
        expect(getInstalled(data, "channelTabs")).toEqual(sampleEntry);
    });

    it("returns undefined when plugin is absent", () => {
        const data = { installed: {} };
        expect(getInstalled(data, "channelTabs")).toBeUndefined();
    });
});

describe("addInstalled", () => {
    it("adds a new plugin entry", () => {
        const data = { installed: {} };
        const result = addInstalled(data, "channelTabs", sampleEntry);
        expect(result.installed.channelTabs).toEqual(sampleEntry);
    });

    it("does not mutate the original lockfile", () => {
        const data = { installed: {} };
        addInstalled(data, "channelTabs", sampleEntry);
        expect(data.installed).toEqual({});
    });

    it("overwrites an existing entry", () => {
        const data = { installed: { channelTabs: sampleEntry } };
        const result = addInstalled(data, "channelTabs", pinnedEntry);
        expect(result.installed.channelTabs).toEqual(pinnedEntry);
        expect(result.installed.channelTabs.version).toBe("2.0.0");
    });
});

describe("removeInstalled", () => {
    it("removes the plugin entry", () => {
        const data = { installed: { channelTabs: sampleEntry, settingsHub: pinnedEntry } };
        const result = removeInstalled(data, "channelTabs");
        expect(result.installed.channelTabs).toBeUndefined();
        expect(result.installed.settingsHub).toEqual(pinnedEntry);
    });

    it("does not mutate the original lockfile", () => {
        const data = { installed: { channelTabs: sampleEntry } };
        removeInstalled(data, "channelTabs");
        expect(data.installed.channelTabs).toEqual(sampleEntry);
    });

    it("is a no-op for a plugin that is not installed", () => {
        const data = { installed: { settingsHub: pinnedEntry } };
        const result = removeInstalled(data, "channelTabs");
        expect(result.installed).toEqual({ settingsHub: pinnedEntry });
    });
});
