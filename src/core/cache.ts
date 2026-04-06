import { dirname, join } from "node:path";
import type { FileSystem } from "./types.js";
import { getConfigDir } from "./paths.js";

export interface CacheEntry {
    url: string;
    etag?: string;
    lastModified?: string;
    body: string;
    cachedAt: string;
}

export interface IndexCache {
    entries: Record<string, CacheEntry>;
}

export function getCachePath(): string {
    return join(getConfigDir(), "index-cache.json");
}

export async function loadCache(fs: FileSystem): Promise<IndexCache> {
    const path = getCachePath();
    const exists = await fs.exists(path);
    if (!exists) return { entries: {} };
    const raw = await fs.readFile(path, "utf-8");
    try {
        return JSON.parse(raw) as IndexCache;
    } catch {
        return { entries: {} };
    }
}

export async function saveCache(fs: FileSystem, cache: IndexCache): Promise<void> {
    const path = getCachePath();
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(cache, null, 2) + "\n");
}

export function getCachedEntry(cache: IndexCache, url: string): CacheEntry | undefined {
    return cache.entries[url];
}

export function setCachedEntry(cache: IndexCache, url: string, entry: CacheEntry): IndexCache {
    return {
        ...cache,
        entries: {
            ...cache.entries,
            [url]: entry,
        },
    };
}
