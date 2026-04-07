import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { fetchAllIndexes, searchPlugins } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { createRealIOContext } from "./context.js";

export async function executeSearch(ctx: IOContext, query: string, options: GlobalOptions = {}): Promise<void> {
    const { renderer } = ctx;
    const config = await loadConfig(ctx.fs, options.config ?? getConfigPath());
    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);

    for (const fi of indexes) {
        if (fi.error) {
            renderer.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const results = searchPlugins(indexes, query);

    if (results.length === 0) {
        renderer.text(`No plugins found matching "${query}"`);
        renderer.finish(true, { results: [] });
        return;
    }

    renderer.heading(`Search results for "${query}" (${results.length} found)`);
    renderer.table(
        ["Name", "Version", "Description", "Repo"],
        results.map(r => [
            r.name,
            r.entry.version,
            r.entry.description ?? "",
            r.repoName,
        ]),
    );

    renderer.finish(true, {
        results: results.map(r => ({
            name: r.name,
            version: r.entry.version,
            description: r.entry.description ?? null,
            repo: r.repoName,
        })),
    });
}

export function registerSearchCommand(program: Command): void {
    program
        .command("search <query>")
        .description("Search for plugins in configured repositories")
        .action(async (query: string) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            await executeSearch(ctx, query, globalOpts);
        });
}
