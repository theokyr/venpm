import type { HttpClient, RepoEntry, PluginIndex, PluginEntry } from "./types.js";

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

/**
 * Fetch a single plugin index from `url` using `http`.
 * Throws on HTTP error or invalid JSON.
 */
export async function fetchIndex(http: HttpClient, url: string): Promise<PluginIndex> {
    const response = await http.fetch(url);
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
    return parsed as PluginIndex;
}

/**
 * Fetch all indexes in parallel, capturing errors into FetchedIndex.error (never throwing).
 */
export async function fetchAllIndexes(http: HttpClient, repos: RepoEntry[]): Promise<FetchedIndex[]> {
    return Promise.all(
        repos.map(async (repo): Promise<FetchedIndex> => {
            try {
                const index = await fetchIndex(http, repo.url);
                return { repoName: repo.name, index };
            } catch (err) {
                return {
                    repoName: repo.name,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        })
    );
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
