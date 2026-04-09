import type { HttpClient, RepoEntry, PluginIndex, PluginEntry } from "./types.js";
import type { CacheEntry, IndexCache } from "./cache.js";
import { getCachedEntry, setCachedEntry } from "./cache.js";

export interface FetchedIndex {
    repoName: string;
    index?: PluginIndex;
    error?: string;
}

export interface PluginMatch {
    name: string;
    repoName: string;
    entry: PluginEntry;
}

export interface FetchIndexOptions {
    cached?: CacheEntry;
}

export interface FetchIndexResult {
    index: PluginIndex;
    updatedEntry?: CacheEntry;
}

/**
 * Fetch a single plugin index from `url` using `http`.
 * If a cached entry is provided, sends conditional request headers.
 * On 304 Not Modified, returns the cached body.
 * On 200, updates the cache entry with new ETag/Last-Modified.
 * Throws on HTTP error or invalid JSON.
 */
export async function fetchIndex(
    http: HttpClient,
    url: string,
    options?: FetchIndexOptions,
): Promise<FetchIndexResult> {
    const cached = options?.cached;
    const headers: Record<string, string> = {};

    if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
    }
    if (cached?.lastModified) {
        headers["If-Modified-Since"] = cached.lastModified;
    }

    const response = await http.fetch(url, Object.keys(headers).length > 0 ? { headers } : undefined);

    // 304 Not Modified — use cached body
    if (response.status === 304 && cached) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(cached.body);
        } catch {
            throw new Error(`Invalid JSON in cache for ${url}`);
        }
        return { index: parsed as PluginIndex };
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const text = await response.text();
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`Invalid JSON from ${url}`);
    }

    // Build updated cache entry from response headers
    const etag = response.headers?.get("etag") ?? undefined;
    const lastModified = response.headers?.get("last-modified") ?? undefined;

    const updatedEntry: CacheEntry = {
        url,
        etag,
        lastModified,
        body: text,
        cachedAt: new Date().toISOString(),
    };

    return { index: parsed as PluginIndex, updatedEntry };
}

export interface FetchAllIndexesOptions {
    cache?: IndexCache;
}

export interface FetchAllIndexesResult {
    results: FetchedIndex[];
    updatedCache: IndexCache;
}

/**
 * Fetch all indexes in parallel, capturing errors into FetchedIndex.error (never throwing).
 * Accepts an optional cache; returns an updated cache with any new/refreshed entries.
 */
export async function fetchAllIndexes(
    http: HttpClient,
    repos: RepoEntry[],
    options?: FetchAllIndexesOptions,
): Promise<FetchAllIndexesResult> {
    const inputCache: IndexCache = options?.cache ?? { entries: {} };

    const pairs = await Promise.all(
        repos.map(async (repo): Promise<{ fi: FetchedIndex; updatedEntry?: CacheEntry; url: string }> => {
            const cached = getCachedEntry(inputCache, repo.url);
            try {
                const result = await fetchIndex(http, repo.url, cached ? { cached } : undefined);
                return {
                    fi: { repoName: repo.name, index: result.index },
                    updatedEntry: result.updatedEntry,
                    url: repo.url,
                };
            } catch (err) {
                return {
                    fi: {
                        repoName: repo.name,
                        error: err instanceof Error ? err.message : String(err),
                    },
                    url: repo.url,
                };
            }
        })
    );

    let updatedCache = inputCache;
    for (const { updatedEntry, url } of pairs) {
        if (updatedEntry) {
            updatedCache = setCachedEntry(updatedCache, url, updatedEntry);
        }
    }

    return {
        results: pairs.map(p => p.fi),
        updatedCache,
    };
}

/**
 * Find a plugin by name across fetched indexes.
 * If `fromRepo` is given, only that repo is searched.
 * Returns `undefined` when not found.
 */
export function resolvePlugin(
    indexes: FetchedIndex[],
    pluginName: string,
    fromRepo?: string
): PluginMatch | undefined {
    const candidates = fromRepo
        ? indexes.filter(fi => fi.repoName === fromRepo)
        : indexes;

    for (const fi of candidates) {
        if (!fi.index) continue;
        const entry = fi.index.plugins[pluginName];
        if (entry) {
            return { name: pluginName, repoName: fi.repoName, entry };
        }
    }
    return undefined;
}

/**
 * Fuzzy search plugins by name and description across all fetched indexes.
 * Name matches are returned before description-only matches.
 * Case-insensitive substring match.
 */
export function searchPlugins(indexes: FetchedIndex[], query: string): PluginMatch[] {
    const q = query.toLowerCase();
    const nameMatches: PluginMatch[] = [];
    const descMatches: PluginMatch[] = [];

    for (const fi of indexes) {
        if (!fi.index) continue;
        for (const [name, entry] of Object.entries(fi.index.plugins)) {
            const nameHit = name.toLowerCase().includes(q);
            const descHit = entry.description?.toLowerCase().includes(q) ?? false;
            if (nameHit) {
                nameMatches.push({ name, repoName: fi.repoName, entry });
            } else if (descHit) {
                descMatches.push({ name, repoName: fi.repoName, entry });
            }
        }
    }

    return [...nameMatches, ...descMatches];
}
