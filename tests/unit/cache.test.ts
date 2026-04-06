import { describe, it, expect, vi } from "vitest";
import type { FileSystem } from "../../src/core/types.js";
import {
    loadCache,
    saveCache,
    getCachedEntry,
    setCachedEntry,
    type CacheEntry,
    type IndexCache,
} from "../../src/core/cache.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFs(opts: { exists?: boolean; content?: string } = {}): FileSystem {
    const exists = opts.exists ?? false;
    const content = opts.content ?? "";
    const writtenData: { path: string; data: string }[] = [];

    return {
        async exists(_path: string) { return exists; },
        async readFile(_path: string, _enc: BufferEncoding) { return content; },
        async writeFile(path: string, data: string) { writtenData.push({ path, data }); },
        async mkdir(_path: string, _opts?: { recursive?: boolean }) {},
        async rm(_path: string) {},
        async symlink(_target: string, _path: string) {},
        async readlink(_path: string) { return ""; },
        async readdir(_path: string) { return []; },
        async stat(_path: string) {
            return { isDirectory: () => false, isFile: () => true, size: 0 };
        },
        async lstat(_path: string) {
            return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
        },
        async copyDir(_src: string, _dest: string) {},
        _written: writtenData,
    } as unknown as FileSystem & { _written: { path: string; data: string }[] };
}

const SAMPLE_ENTRY: CacheEntry = {
    url: "https://example.com/plugins.json",
    etag: '"abc123"',
    lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    body: '{"name":"test","plugins":{}}',
    cachedAt: "2024-01-01T00:00:00.000Z",
};

const SAMPLE_CACHE: IndexCache = {
    entries: {
        "https://example.com/plugins.json": SAMPLE_ENTRY,
    },
};

// ─── loadCache ────────────────────────────────────────────────────────────────

describe("loadCache", () => {
    it("returns empty cache when file does not exist", async () => {
        const fs = mockFs({ exists: false });
        const cache = await loadCache(fs);
        expect(cache).toEqual({ entries: {} });
    });

    it("parses existing cache file", async () => {
        const fs = mockFs({ exists: true, content: JSON.stringify(SAMPLE_CACHE) });
        const cache = await loadCache(fs);
        expect(cache.entries).toHaveProperty("https://example.com/plugins.json");
        const entry = cache.entries["https://example.com/plugins.json"];
        expect(entry.etag).toBe('"abc123"');
        expect(entry.body).toBe('{"name":"test","plugins":{}}');
    });

    it("returns empty cache when file contains invalid JSON", async () => {
        const fs = mockFs({ exists: true, content: "!!!not json" });
        const cache = await loadCache(fs);
        expect(cache).toEqual({ entries: {} });
    });
});

// ─── saveCache ────────────────────────────────────────────────────────────────

describe("saveCache", () => {
    it("writes formatted JSON to the cache path", async () => {
        const written: { path: string; data: string }[] = [];
        const fs: FileSystem = {
            ...mockFs(),
            async writeFile(path: string, data: string) {
                written.push({ path, data });
            },
            async mkdir(_path: string) {},
        } as unknown as FileSystem;

        await saveCache(fs, SAMPLE_CACHE);

        expect(written).toHaveLength(1);
        const [call] = written;
        // Should end with newline
        expect(call.data).toMatch(/\n$/);
        // Should be valid JSON
        const parsed = JSON.parse(call.data) as IndexCache;
        expect(parsed.entries).toHaveProperty("https://example.com/plugins.json");
        // Should be formatted (indented)
        expect(call.data).toContain("  ");
    });
});

// ─── getCachedEntry ───────────────────────────────────────────────────────────

describe("getCachedEntry", () => {
    it("returns the entry for a known URL", () => {
        const entry = getCachedEntry(SAMPLE_CACHE, "https://example.com/plugins.json");
        expect(entry).toBeDefined();
        expect(entry!.etag).toBe('"abc123"');
    });

    it("returns undefined for an unknown URL", () => {
        const entry = getCachedEntry(SAMPLE_CACHE, "https://unknown.example.com/plugins.json");
        expect(entry).toBeUndefined();
    });
});

// ─── setCachedEntry ───────────────────────────────────────────────────────────

describe("setCachedEntry", () => {
    const newEntry: CacheEntry = {
        url: "https://new.example.com/plugins.json",
        etag: '"newetag"',
        body: '{"name":"new","plugins":{}}',
        cachedAt: "2024-06-01T00:00:00.000Z",
    };

    it("adds a new entry (returns new cache, does not mutate original)", () => {
        const original: IndexCache = { entries: {} };
        const updated = setCachedEntry(original, newEntry.url, newEntry);
        expect(updated.entries).toHaveProperty(newEntry.url);
        // Original is not mutated
        expect(original.entries).not.toHaveProperty(newEntry.url);
    });

    it("updates an existing entry immutably", () => {
        const updatedEntry: CacheEntry = { ...SAMPLE_ENTRY, etag: '"newtag"' };
        const updated = setCachedEntry(
            SAMPLE_CACHE,
            "https://example.com/plugins.json",
            updatedEntry,
        );
        expect(updated.entries["https://example.com/plugins.json"].etag).toBe('"newtag"');
        // Original is not mutated
        expect(SAMPLE_CACHE.entries["https://example.com/plugins.json"].etag).toBe('"abc123"');
    });

    it("preserves other entries when adding a new one", () => {
        const updated = setCachedEntry(SAMPLE_CACHE, newEntry.url, newEntry);
        expect(updated.entries).toHaveProperty("https://example.com/plugins.json");
        expect(updated.entries).toHaveProperty(newEntry.url);
    });
});
