import { describe, it, expect } from "vitest";
import type {
    PluginIndex, PluginEntry, PluginSource, VersionEntry,
    Config, RepoEntry, LockfileData, InstalledPlugin,
    InstallPlan, InstallPlanEntry, IOContext, FetchMethod, RebuildMode,
} from "../../src/core/types.js";

describe("types", () => {
    it("constructs a valid PluginEntry", () => {
        const entry: PluginEntry = {
            version: "1.0.0", description: "Test plugin",
            authors: [{ name: "test", id: "0" }],
            source: { git: "https://github.com/test/repo.git", path: "plugins/testPlugin" },
        };
        expect(entry.version).toBe("1.0.0");
        expect(entry.source.git).toBeDefined();
    });

    it("constructs a PluginEntry with all optional fields", () => {
        const entry: PluginEntry = {
            version: "2.0.0", description: "Full plugin",
            authors: [{ name: "kamaras", id: "123" }],
            license: "MIT", dependencies: ["otherPlugin"],
            discord: ">=2024.01", vencord: ">=1.10.0",
            source: { git: "https://github.com/test/repo.git", path: "plugins/fullPlugin", tarball: "https://example.com/full-2.0.0.tar.gz" },
            versions: {
                "2.0.0": { git_tag: "v2.0.0", tarball: "https://example.com/full-2.0.0.tar.gz" },
                "1.0.0": { git_tag: "v1.0.0" },
            },
        };
        expect(entry.dependencies).toEqual(["otherPlugin"]);
        expect(entry.versions?.["2.0.0"]?.git_tag).toBe("v2.0.0");
    });

    it("constructs a valid PluginIndex", () => {
        const index: PluginIndex = { name: "test-repo", description: "A test repo", plugins: {} };
        expect(index.name).toBe("test-repo");
    });

    it("constructs a valid Config", () => {
        const config: Config = {
            repos: [{ name: "default", url: "https://example.com/plugins.json" }],
            vencord: { path: "/home/user/Vencord" },
            rebuild: "ask",
            discord: { restart: "ask", binary: null },
        };
        expect(config.rebuild).toBe("ask");
    });

    it("constructs a valid InstalledPlugin", () => {
        const installed: InstalledPlugin = {
            version: "1.0.0", repo: "kamaras", method: "git",
            pinned: false, installed_at: "2026-04-06T12:00:00Z",
        };
        expect(installed.method).toBe("git");
    });

    it("constructs an InstalledPlugin with git_ref", () => {
        const installed: InstalledPlugin = {
            version: "1.0.0", repo: "kamaras", method: "git",
            pinned: true, git_ref: "abc1234",
            installed_at: "2026-04-06T12:00:00Z", path: "plugins/channelTabs",
        };
        expect(installed.git_ref).toBe("abc1234");
        expect(installed.pinned).toBe(true);
    });

    it("constructs a valid InstallPlan", () => {
        const plan: InstallPlan = {
            entries: [
                { name: "settingsHub", version: "1.0.0", repo: "kamaras", source: { git: "https://example.com/repo.git" }, method: "git", isDependency: true },
                { name: "channelTabs", version: "1.3.0", repo: "kamaras", source: { tarball: "https://example.com/ct.tar.gz" }, method: "tarball", isDependency: false },
            ],
        };
        expect(plan.entries).toHaveLength(2);
        expect(plan.entries[0].isDependency).toBe(true);
    });
});
