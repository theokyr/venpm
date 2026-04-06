import { describe, it, expect, vi } from "vitest";
import type { HttpClient, PluginIndex, RepoEntry } from "../../src/core/types.js";
import {
    fetchIndex,
    fetchAllIndexes,
    resolvePlugin,
    searchPlugins,
    type FetchedIndex,
} from "../../src/core/registry.js";
import type { CacheEntry, IndexCache } from "../../src/core/cache.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(opts: {
    ok: boolean;
    status?: number;
    body?: string;
    headers?: Record<string, string>;
}): ReturnType<HttpClient["fetch"]> {
    const hdrs = opts.headers ?? {};
    return Promise.resolve({
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 404),
        headers: {
            get: (name: string) => hdrs[name.toLowerCase()] ?? hdrs[name] ?? null,
        },
        text: vi.fn(() => Promise.resolve(opts.body ?? "")),
        json: vi.fn(() => Promise.resolve(JSON.parse(opts.body ?? "{}"))),
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
    });
}

function mockHttp(handler: (url: string, opts?: { headers?: Record<string, string> }) => ReturnType<HttpClient["fetch"]>): HttpClient {
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
        expect(result.index.name).toBe("test-repo");
        expect(result.index.plugins).toHaveProperty("CoolPlugin");
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

        const { results } = await fetchAllIndexes(http, repos);
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

        const { results } = await fetchAllIndexes(http, repos);
        expect(results).toHaveLength(2);
        expect(results[0].index).toBeDefined();
        expect(results[0].error).toBeUndefined();
        expect(results[1].index).toBeUndefined();
        expect(results[1].error).toMatch(/503/);
    });

    it("captures JSON parse errors without throwing", async () => {
        const repos: RepoEntry[] = [{ name: "broken", url: "https://example.com/broken.json" }];
        const http = mockHttp(() => mockResponse({ ok: true, body: "!!not-json" }));

        const { results } = await fetchAllIndexes(http, repos);
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

// ─── fetchIndex caching ───────────────────────────────────────────────────────

describe("fetchIndex caching", () => {
    it("sends If-None-Match header when cache has etag", async () => {
        const sentHeaders: Record<string, string>[] = [];
        const http = mockHttp((_url, opts) => {
            if (opts?.headers) sentHeaders.push(opts.headers);
            return mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) });
        });

        const cached: CacheEntry = {
            url: "https://example.com/plugins.json",
            etag: '"abc123"',
            body: JSON.stringify(VALID_INDEX),
            cachedAt: "2024-01-01T00:00:00.000Z",
        };

        await fetchIndex(http, "https://example.com/plugins.json", { cached });

        expect(sentHeaders).toHaveLength(1);
        expect(sentHeaders[0]["If-None-Match"]).toBe('"abc123"');
    });

    it("sends If-Modified-Since header when cache has lastModified", async () => {
        const sentHeaders: Record<string, string>[] = [];
        const http = mockHttp((_url, opts) => {
            if (opts?.headers) sentHeaders.push(opts.headers);
            return mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) });
        });

        const cached: CacheEntry = {
            url: "https://example.com/plugins.json",
            lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
            body: JSON.stringify(VALID_INDEX),
            cachedAt: "2024-01-01T00:00:00.000Z",
        };

        await fetchIndex(http, "https://example.com/plugins.json", { cached });

        expect(sentHeaders).toHaveLength(1);
        expect(sentHeaders[0]["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    });

    it("returns cached body on 304 response", async () => {
        const http = mockHttp(() => mockResponse({ ok: false, status: 304 }));

        const cached: CacheEntry = {
            url: "https://example.com/plugins.json",
            etag: '"abc123"',
            body: JSON.stringify(VALID_INDEX),
            cachedAt: "2024-01-01T00:00:00.000Z",
        };

        const result = await fetchIndex(http, "https://example.com/plugins.json", { cached });
        expect(result.index.name).toBe("test-repo");
        // No updatedEntry since content didn't change
        expect(result.updatedEntry).toBeUndefined();
    });

    it("updates cache entry on 200 response with new etag", async () => {
        const http = mockHttp(() => mockResponse({
            ok: true,
            body: JSON.stringify(VALID_INDEX),
            headers: { etag: '"newetag456"' },
        }));

        const result = await fetchIndex(http, "https://example.com/plugins.json");
        expect(result.index.name).toBe("test-repo");
        expect(result.updatedEntry).toBeDefined();
        expect(result.updatedEntry!.etag).toBe('"newetag456"');
        expect(result.updatedEntry!.url).toBe("https://example.com/plugins.json");
        expect(result.updatedEntry!.body).toBe(JSON.stringify(VALID_INDEX));
    });

    it("works normally without cache options (backward compat)", async () => {
        const http = mockHttp(() => mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) }));
        const result = await fetchIndex(http, "https://example.com/plugins.json");
        expect(result.index.name).toBe("test-repo");
        expect(result.index.plugins).toHaveProperty("CoolPlugin");
    });
});

// ─── fetchAllIndexes caching ──────────────────────────────────────────────────

describe("fetchAllIndexes caching", () => {
    it("passes cache entry to fetchIndex when URL matches", async () => {
        const sentHeaders: Record<string, string>[] = [];
        const http = mockHttp((_url, opts) => {
            if (opts?.headers) sentHeaders.push({ ...opts.headers });
            return mockResponse({ ok: true, body: JSON.stringify(VALID_INDEX) });
        });

        const cache: IndexCache = {
            entries: {
                "https://example.com/plugins.json": {
                    url: "https://example.com/plugins.json",
                    etag: '"cached-etag"',
                    body: JSON.stringify(VALID_INDEX),
                    cachedAt: "2024-01-01T00:00:00.000Z",
                },
            },
        };

        const repos: RepoEntry[] = [{ name: "test", url: "https://example.com/plugins.json" }];
        await fetchAllIndexes(http, repos, { cache });

        expect(sentHeaders).toHaveLength(1);
        expect(sentHeaders[0]["If-None-Match"]).toBe('"cached-etag"');
    });

    it("returns updated cache containing new etags", async () => {
        const http = mockHttp(() => mockResponse({
            ok: true,
            body: JSON.stringify(VALID_INDEX),
            headers: { etag: '"freshTag"' },
        }));

        const repos: RepoEntry[] = [{ name: "test", url: "https://example.com/plugins.json" }];
        const { updatedCache } = await fetchAllIndexes(http, repos);

        expect(updatedCache.entries).toHaveProperty("https://example.com/plugins.json");
        expect(updatedCache.entries["https://example.com/plugins.json"].etag).toBe('"freshTag"');
    });

    it("does not overwrite cache entry on 304 (no updatedEntry)", async () => {
        const http = mockHttp(() => mockResponse({ ok: false, status: 304 }));

        const existingEntry: CacheEntry = {
            url: "https://example.com/plugins.json",
            etag: '"old-etag"',
            body: JSON.stringify(VALID_INDEX),
            cachedAt: "2024-01-01T00:00:00.000Z",
        };
        const cache: IndexCache = {
            entries: { "https://example.com/plugins.json": existingEntry },
        };

        const repos: RepoEntry[] = [{ name: "test", url: "https://example.com/plugins.json" }];
        const { results, updatedCache } = await fetchAllIndexes(http, repos, { cache });

        // Plugin was served from cache
        expect(results[0].index?.name).toBe("test-repo");
        // Cache entry etag unchanged (304 → no updatedEntry → no overwrite)
        expect(updatedCache.entries["https://example.com/plugins.json"].etag).toBe('"old-etag"');
    });
});
