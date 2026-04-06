import { describe, it, expect } from "vitest";
import type { LockfileData, PluginIndex } from "../../src/core/types.js";
import {
    ResolverError,
    findPlugin,
    resolveVersion,
    buildDependencyGraph,
    generateInstallPlan,
} from "../../src/core/resolver.js";

// ─── Test Data Factories ──────────────────────────────────────────────────────

function makeIndex(name: string, plugins: PluginIndex["plugins"]): PluginIndex {
    return { name, plugins };
}

const BASE_SOURCE = { git: "https://git.example.com/repo.git", tarball: "https://example.com/plugin.tar.gz" };
const GIT_ONLY_SOURCE = { git: "https://git.example.com/repo.git" };
const TARBALL_ONLY_SOURCE = { tarball: "https://example.com/plugin.tar.gz" };
const LOCAL_ONLY_SOURCE = { local: "/home/user/plugins/myPlugin" };

function makeEntry(overrides: Partial<PluginIndex["plugins"][string]> = {}): PluginIndex["plugins"][string] {
    return {
        version: "1.0.0",
        description: "A test plugin",
        authors: [{ name: "kamaras", id: "123" }],
        source: BASE_SOURCE,
        ...overrides,
    };
}

const EMPTY_LOCKFILE: LockfileData = { installed: {} };

function lockfileWith(...names: string[]): LockfileData {
    const installed: LockfileData["installed"] = {};
    for (const name of names) {
        installed[name] = {
            version: "1.0.0",
            repo: "testRepo",
            method: "git",
            pinned: false,
            installed_at: "2026-04-06T12:00:00Z",
        };
    }
    return { installed };
}

// ─── findPlugin ───────────────────────────────────────────────────────────────

describe("findPlugin", () => {
    it("finds a plugin in the first index", () => {
        const idx = makeIndex("repoA", { myPlugin: makeEntry() });
        const result = findPlugin([idx], "myPlugin");
        expect(result).not.toBeNull();
        expect(result!.repoName).toBe("repoA");
        expect(result!.entry.version).toBe("1.0.0");
    });

    it("finds a plugin in a later index", () => {
        const idxA = makeIndex("repoA", { alpha: makeEntry() });
        const idxB = makeIndex("repoB", { beta: makeEntry({ version: "2.0.0" }) });
        const result = findPlugin([idxA, idxB], "beta");
        expect(result!.repoName).toBe("repoB");
        expect(result!.entry.version).toBe("2.0.0");
    });

    it("returns null when plugin is not found", () => {
        const idx = makeIndex("repoA", { myPlugin: makeEntry() });
        expect(findPlugin([idx], "unknown")).toBeNull();
    });

    it("respects fromRepo filter", () => {
        const idxA = makeIndex("repoA", { shared: makeEntry({ version: "1.0.0" }) });
        const idxB = makeIndex("repoB", { shared: makeEntry({ version: "2.0.0" }) });
        const result = findPlugin([idxA, idxB], "shared", "repoB");
        expect(result!.repoName).toBe("repoB");
        expect(result!.entry.version).toBe("2.0.0");
    });

    it("returns null when fromRepo filter excludes all indexes", () => {
        const idx = makeIndex("repoA", { myPlugin: makeEntry() });
        expect(findPlugin([idx], "myPlugin", "repoB")).toBeNull();
    });
});

// ─── resolveVersion ───────────────────────────────────────────────────────────

describe("resolveVersion", () => {
    it("returns the latest version when no constraint is given", () => {
        const entry = makeEntry({ version: "3.2.1" });
        expect(resolveVersion(entry)).toBe("3.2.1");
    });

    it("returns the latest version when constraint is undefined", () => {
        const entry = makeEntry({ version: "2.0.0" });
        expect(resolveVersion(entry, undefined)).toBe("2.0.0");
    });

    it("returns a specific version from the versions map", () => {
        const entry = makeEntry({
            version: "2.0.0",
            versions: {
                "1.0.0": { git_tag: "v1.0.0" },
                "2.0.0": { git_tag: "v2.0.0" },
            },
        });
        expect(resolveVersion(entry, "1.0.0")).toBe("1.0.0");
    });

    it("returns the constraint itself when it exists in the versions map", () => {
        const entry = makeEntry({
            version: "2.0.0",
            versions: { "1.5.0": { tarball: "https://example.com/v1.5.0.tar.gz" } },
        });
        expect(resolveVersion(entry, "1.5.0")).toBe("1.5.0");
    });

    it("throws ResolverError when the requested version is not in the map", () => {
        const entry = makeEntry({
            version: "2.0.0",
            versions: { "1.0.0": { git_tag: "v1.0.0" } },
        });
        expect(() => resolveVersion(entry, "9.9.9")).toThrow(ResolverError);
        expect(() => resolveVersion(entry, "9.9.9")).toThrow("9.9.9");
    });

    it("throws ResolverError when versions map is absent and a constraint is given", () => {
        const entry = makeEntry({ version: "1.0.0" }); // no versions field
        expect(() => resolveVersion(entry, "0.5.0")).toThrow(ResolverError);
    });

    it("error message lists available versions", () => {
        const entry = makeEntry({
            version: "2.0.0",
            versions: { "1.0.0": {}, "1.5.0": {} },
        });
        let msg = "";
        try { resolveVersion(entry, "3.0.0"); } catch (e) { msg = (e as Error).message; }
        expect(msg).toContain("1.0.0");
        expect(msg).toContain("1.5.0");
    });
});

// ─── buildDependencyGraph ────────────────────────────────────────────────────

describe("buildDependencyGraph", () => {
    it("returns just the plugin when it has no dependencies", () => {
        const idx = makeIndex("repo", { alpha: makeEntry() });
        expect(buildDependencyGraph([idx], "alpha")).toEqual(["alpha"]);
    });

    it("returns direct dependencies before the plugin", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({ dependencies: ["beta"] }),
            beta: makeEntry(),
        });
        const order = buildDependencyGraph([idx], "alpha");
        expect(order.indexOf("beta")).toBeLessThan(order.indexOf("alpha"));
        expect(order).toContain("alpha");
        expect(order).toContain("beta");
    });

    it("resolves transitive dependencies in correct order", () => {
        // alpha → beta → gamma
        const idx = makeIndex("repo", {
            alpha: makeEntry({ dependencies: ["beta"] }),
            beta: makeEntry({ dependencies: ["gamma"] }),
            gamma: makeEntry(),
        });
        const order = buildDependencyGraph([idx], "alpha");
        expect(order).toEqual(["gamma", "beta", "alpha"]);
    });

    it("handles a plugin with multiple direct dependencies", () => {
        const idx = makeIndex("repo", {
            root: makeEntry({ dependencies: ["depA", "depB"] }),
            depA: makeEntry(),
            depB: makeEntry(),
        });
        const order = buildDependencyGraph([idx], "root");
        expect(order.indexOf("depA")).toBeLessThan(order.indexOf("root"));
        expect(order.indexOf("depB")).toBeLessThan(order.indexOf("root"));
        expect(order).toHaveLength(3);
    });

    it("includes each dep only once for diamond dependency", () => {
        // root → A, B; A → shared; B → shared
        const idx = makeIndex("repo", {
            root: makeEntry({ dependencies: ["A", "B"] }),
            A: makeEntry({ dependencies: ["shared"] }),
            B: makeEntry({ dependencies: ["shared"] }),
            shared: makeEntry(),
        });
        const order = buildDependencyGraph([idx], "root");
        expect(order.filter(n => n === "shared")).toHaveLength(1);
        expect(order.indexOf("shared")).toBeLessThan(order.indexOf("A"));
        expect(order.indexOf("shared")).toBeLessThan(order.indexOf("B"));
    });

    it("throws ResolverError for a direct circular dependency", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({ dependencies: ["beta"] }),
            beta: makeEntry({ dependencies: ["alpha"] }),
        });
        expect(() => buildDependencyGraph([idx], "alpha")).toThrow(ResolverError);
        expect(() => buildDependencyGraph([idx], "alpha")).toThrow("Circular dependency");
    });

    it("throws ResolverError for a self-referencing plugin", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({ dependencies: ["alpha"] }),
        });
        expect(() => buildDependencyGraph([idx], "alpha")).toThrow(ResolverError);
    });

    it("throws ResolverError when a dependency is missing from all indexes", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({ dependencies: ["ghost"] }),
        });
        expect(() => buildDependencyGraph([idx], "alpha")).toThrow(ResolverError);
        expect(() => buildDependencyGraph([idx], "alpha")).toThrow("ghost");
    });

    it("throws ResolverError when the root plugin itself is missing", () => {
        const idx = makeIndex("repo", {});
        expect(() => buildDependencyGraph([idx], "missing")).toThrow(ResolverError);
    });

    it("searches across multiple indexes for dependencies", () => {
        const idxA = makeIndex("repoA", {
            alpha: makeEntry({ dependencies: ["beta"] }),
        });
        const idxB = makeIndex("repoB", { beta: makeEntry() });
        const order = buildDependencyGraph([idxA, idxB], "alpha");
        expect(order).toEqual(["beta", "alpha"]);
    });
});

// ─── generateInstallPlan ─────────────────────────────────────────────────────

describe("generateInstallPlan", () => {
    it("produces a single entry for a plugin with no deps", () => {
        const idx = makeIndex("repo", { alpha: makeEntry() });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: true });
        expect(plan.entries).toHaveLength(1);
        expect(plan.entries[0].name).toBe("alpha");
        expect(plan.entries[0].isDependency).toBe(false);
    });

    it("marks dependencies as isDependency=true", () => {
        const idx = makeIndex("repo", {
            root: makeEntry({ dependencies: ["dep"] }),
            dep: makeEntry(),
        });
        const plan = generateInstallPlan([idx], "root", EMPTY_LOCKFILE, { gitAvailable: true });
        const depEntry = plan.entries.find(e => e.name === "dep")!;
        const rootEntry = plan.entries.find(e => e.name === "root")!;
        expect(depEntry.isDependency).toBe(true);
        expect(rootEntry.isDependency).toBe(false);
    });

    it("returns deps before the root plugin", () => {
        const idx = makeIndex("repo", {
            root: makeEntry({ dependencies: ["dep"] }),
            dep: makeEntry(),
        });
        const plan = generateInstallPlan([idx], "root", EMPTY_LOCKFILE, { gitAvailable: true });
        const names = plan.entries.map(e => e.name);
        expect(names.indexOf("dep")).toBeLessThan(names.indexOf("root"));
    });

    it("skips already-installed plugins", () => {
        const idx = makeIndex("repo", {
            root: makeEntry({ dependencies: ["dep"] }),
            dep: makeEntry(),
        });
        const lockfile = lockfileWith("dep");
        const plan = generateInstallPlan([idx], "root", lockfile, { gitAvailable: true });
        const names = plan.entries.map(e => e.name);
        expect(names).not.toContain("dep");
        expect(names).toContain("root");
    });

    it("returns empty entries when all plugins are already installed", () => {
        const idx = makeIndex("repo", { alpha: makeEntry() });
        const lockfile = lockfileWith("alpha");
        const plan = generateInstallPlan([idx], "alpha", lockfile, { gitAvailable: true });
        expect(plan.entries).toHaveLength(0);
    });

    it("selects git method when git is available and source has git URL", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: GIT_ONLY_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: true });
        expect(plan.entries[0].method).toBe("git");
    });

    it("falls back to tarball when git is unavailable", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: BASE_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: false });
        expect(plan.entries[0].method).toBe("tarball");
    });

    it("uses tarball when source has only tarball", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: TARBALL_ONLY_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: true });
        expect(plan.entries[0].method).toBe("tarball");
    });

    it("uses local when source has only local path", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: LOCAL_ONLY_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: true });
        expect(plan.entries[0].method).toBe("local");
    });

    it("respects forceMethod=tarball even when git is available", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: BASE_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, {
            gitAvailable: true,
            forceMethod: "tarball",
        });
        expect(plan.entries[0].method).toBe("tarball");
    });

    it("respects forceMethod=git", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: BASE_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, {
            gitAvailable: true,
            forceMethod: "git",
        });
        expect(plan.entries[0].method).toBe("git");
    });

    it("throws ResolverError when forceMethod is not available in source", () => {
        const idx = makeIndex("repo", { alpha: makeEntry({ source: TARBALL_ONLY_SOURCE }) });
        expect(() =>
            generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, {
                gitAvailable: false,
                forceMethod: "git",
            }),
        ).toThrow(ResolverError);
    });

    it("uses a specific version when options.version is provided", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({
                version: "2.0.0",
                versions: { "1.0.0": { git_tag: "v1.0.0" }, "2.0.0": { git_tag: "v2.0.0" } },
            }),
        });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, {
            gitAvailable: true,
            version: "1.0.0",
        });
        expect(plan.entries[0].version).toBe("1.0.0");
    });

    it("uses latest version when options.version is not provided", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({
                version: "2.0.0",
                versions: { "1.0.0": {}, "2.0.0": {} },
            }),
        });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: true });
        expect(plan.entries[0].version).toBe("2.0.0");
    });

    it("throws ResolverError when requested version does not exist", () => {
        const idx = makeIndex("repo", {
            alpha: makeEntry({ version: "1.0.0", versions: { "1.0.0": {} } }),
        });
        expect(() =>
            generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, {
                gitAvailable: true,
                version: "9.9.9",
            }),
        ).toThrow(ResolverError);
    });

    it("populates repo, source fields correctly", () => {
        const idx = makeIndex("myRepo", { alpha: makeEntry({ source: BASE_SOURCE }) });
        const plan = generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: true });
        expect(plan.entries[0].repo).toBe("myRepo");
        expect(plan.entries[0].source).toEqual(BASE_SOURCE);
    });

    it("throws when no suitable method is available", () => {
        // source with no git, tarball, or local
        const idx = makeIndex("repo", { alpha: makeEntry({ source: {} as never }) });
        expect(() =>
            generateInstallPlan([idx], "alpha", EMPTY_LOCKFILE, { gitAvailable: false }),
        ).toThrow(ResolverError);
    });
});
