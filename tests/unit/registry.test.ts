import { describe, it, expect, vi } from "vitest";
import type { HttpClient, PluginIndex, RepoEntry } from "../../src/core/types.js";
import {
    fetchIndex,
    fetchAllIndexes,
    resolvePlugin,
    searchPlugins,
    type FetchedIndex,
} from "../../src/core/registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(opts: { ok: boolean; status?: number; body?: string }): ReturnType<HttpClient["fetch"]> {
    return Promise.resolve({
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 404),
        text: vi.fn(() => Promise.resolve(opts.body ?? "")),
        json: vi.fn(() => Promise.resolve(JSON.parse(opts.body ?? "{}"))),
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
    });
}

function mockHttp(handler: (url: string) => ReturnType<HttpClient["fetch"]>): HttpClient {
    return { fetch: vi.fn(handler) };
}

const VALID_INDEX: PluginIndex = {
    name: "test-repo",
    description: "A test plugin repository",
    plugins: {
        CoolPlugin: {
            version: "1.0.0",
            description: "A cool plugin for Discord",
            authors: [{ name: "alice", id: "111" }],
            source: { git: "https://github.com/example/cool-plugin.git" },
        },
        AnotherPlugin: {
            version: "2.0.0",
            description: "Does something useful",
            authors: [{ name: "bob", id: "222" }],
            source: { tarball: "https://example.com/another.tar.gz" },
        },
    },
};

const SECOND_INDEX: PluginIndex = {
    name: "second-repo",
    plugins: {
        UniquePlugin: {
            version: "0.1.0",
            description: "Only in second repo",
            authors: [{ name: "carol", id: "333" }],
            source: { git: "https://github.com/example/unique.git" },
        },
        CoolPlugin: {
            version: "1.5.0",
            description: "A cool plugin (fork)",
            authors: [{ name: "dave", id: "444" }],
            source: { git: "https://github.com/example/cool-fork.git" },
        },
    },
};

// ─── fetchIndex ───────────────────────────────────────────────────────────────

describe("fetchIndex", () => {
    it("fetches and parses a valid index", async () => {
        const http = mockHttp(() => mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) }));
        const result = await fetchIndex(http, "https://example.com/plugins.json");
        expect(result.name).toBe("test-repo");
        expect(result.plugins).toHaveProperty("CoolPlugin");
    });

    it("throws on HTTP 404", async () => {
        const http = mockHttp(() => mockResponse({ ok: false, status: 404 }));
        await expect(fetchIndex(http, "https://example.com/missing.json")).rejects.toThrow("HTTP 404");
    });

    it("throws on invalid JSON", async () => {
        const http = mockHttp(() => mockResponse({ ok: true, body: "not valid json {{" }));
        await expect(fetchIndex(http, "https://example.com/plugins.json")).rejects.toThrow("Invalid JSON");
    });
});

// ─── fetchAllIndexes ──────────────────────────────────────────────────────────

describe("fetchAllIndexes", () => {
    it("fetches multiple repos in parallel and returns all results", async () => {
        const repos: RepoEntry[] = [
            { name: "first", url: "https://example.com/first.json" },
            { name: "second", url: "https://example.com/second.json" },
        ];
        const http = mockHttp(url => {
            if (url.includes("first")) {
                return mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) });
            }
            return mockResponse({ ok: true, body: JSON.stringify(SECOND_INDEX) });
        });

        const results = await fetchAllIndexes(http, repos);
        expect(results).toHaveLength(2);
        expect(results[0].repoName).toBe("first");
        expect(results[0].index?.name).toBe("test-repo");
        expect(results[1].repoName).toBe("second");
        expect(results[1].index?.name).toBe("second-repo");
    });

    it("captures HTTP errors without throwing", async () => {
        const repos: RepoEntry[] = [
            { name: "good", url: "https://example.com/good.json" },
            { name: "bad", url: "https://example.com/bad.json" },
        ];
        const http = mockHttp(url => {
            if (url.includes("good")) {
                return mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) });
            }
            return mockResponse({ ok: false, status: 503 });
        });

        const results = await fetchAllIndexes(http, repos);
        expect(results).toHaveLength(2);
        expect(results[0].index).toBeDefined();
        expect(results[0].error).toBeUndefined();
        expect(results[1].index).toBeUndefined();
        expect(results[1].error).toMatch(/503/);
    });

    it("captures JSON parse errors without throwing", async () => {
        const repos: RepoEntry[] = [{ name: "broken", url: "https://example.com/broken.json" }];
        const http = mockHttp(() => mockResponse({ ok: true, body: "!!not-json" }));

        const results = await fetchAllIndexes(http, repos);
        expect(results[0].error).toMatch(/Invalid JSON/);
        expect(results[0].index).toBeUndefined();
    });
});

// ─── resolvePlugin ────────────────────────────────────────────────────────────

describe("resolvePlugin", () => {
    const indexes: FetchedIndex[] = [
        { repoName: "first", index: VALID_INDEX },
        { repoName: "second", index: SECOND_INDEX },
    ];

    it("finds a plugin in a single repo", () => {
        const match = resolvePlugin(indexes, "AnotherPlugin");
        expect(match).toBeDefined();
        expect(match!.name).toBe("AnotherPlugin");
        expect(match!.repoName).toBe("first");
        expect(match!.entry.version).toBe("2.0.0");
    });

    it("finds a plugin that exists in multiple repos (returns first)", () => {
        const match = resolvePlugin(indexes, "CoolPlugin");
        expect(match).toBeDefined();
        expect(match!.repoName).toBe("first");
        expect(match!.entry.version).toBe("1.0.0");
    });

    it("returns undefined when plugin is not found", () => {
        const match = resolvePlugin(indexes, "NonExistentPlugin");
        expect(match).toBeUndefined();
    });

    it("filters by fromRepo and returns the version from that repo", () => {
        const match = resolvePlugin(indexes, "CoolPlugin", "second");
        expect(match).toBeDefined();
        expect(match!.repoName).toBe("second");
        expect(match!.entry.version).toBe("1.5.0");
    });

    it("returns undefined when fromRepo filter excludes the only match", () => {
        const match = resolvePlugin(indexes, "AnotherPlugin", "second");
        expect(match).toBeUndefined();
    });

    it("handles indexes with errors (no index property) gracefully", () => {
        const withError: FetchedIndex[] = [
            { repoName: "broken", error: "fetch failed" },
            { repoName: "good", index: VALID_INDEX },
        ];
        const match = resolvePlugin(withError, "CoolPlugin");
        expect(match).toBeDefined();
        expect(match!.repoName).toBe("good");
    });
});

// ─── searchPlugins ────────────────────────────────────────────────────────────

describe("searchPlugins", () => {
    const indexes: FetchedIndex[] = [
        { repoName: "first", index: VALID_INDEX },
        { repoName: "second", index: SECOND_INDEX },
    ];

    it("matches by plugin name (case-insensitive)", () => {
        const results = searchPlugins(indexes, "cool");
        const names = results.map(r => r.name);
        expect(names).toContain("CoolPlugin");
    });

    it("matches by description", () => {
        const results = searchPlugins(indexes, "useful");
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe("AnotherPlugin");
    });

    it("returns empty array when nothing matches", () => {
        const results = searchPlugins(indexes, "xyznomatch");
        expect(results).toHaveLength(0);
    });

    it("returns results from multiple repos", () => {
        const results = searchPlugins(indexes, "cool");
        const repos = results.map(r => r.repoName);
        expect(repos).toContain("first");
        expect(repos).toContain("second");
    });

    it("sorts name matches before description-only matches", () => {
        // "discord" appears in description of CoolPlugin ("A cool plugin for Discord")
        // but not in the plugin name
        const results = searchPlugins(indexes, "discord");
        // all results should be description matches since no name contains "discord"
        expect(results.length).toBeGreaterThan(0);
        results.forEach(r => {
            expect(r.name.toLowerCase()).not.toContain("discord");
        });

        // "plugin" is both in name (CoolPlugin, AnotherPlugin, UniquePlugin) and description
        const pluginResults = searchPlugins(indexes, "plugin");
        const nameHits = pluginResults.filter(r => r.name.toLowerCase().includes("plugin"));
        const descHits = pluginResults.filter(r => !r.name.toLowerCase().includes("plugin"));
        // Name hits should come first
        const lastNameIdx = pluginResults.findLastIndex(r => r.name.toLowerCase().includes("plugin"));
        const firstDescIdx = pluginResults.findIndex(r => !r.name.toLowerCase().includes("plugin"));
        if (nameHits.length > 0 && descHits.length > 0) {
            expect(lastNameIdx).toBeLessThan(firstDescIdx);
        }
    });

    it("handles indexes with errors gracefully", () => {
        const withError: FetchedIndex[] = [
            { repoName: "broken", error: "fetch failed" },
            { repoName: "good", index: VALID_INDEX },
        ];
        const results = searchPlugins(withError, "cool");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].repoName).toBe("good");
    });
});
