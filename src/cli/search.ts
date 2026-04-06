import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { fetchAllIndexes, searchPlugins } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { jsonSuccess, writeJson } from "../core/json.js";
import { createRealIOContext } from "./context.js";

export async function executeSearch(ctx: IOContext, query: string, options: GlobalOptions = {}): Promise<void> {
    const config = await loadConfig(ctx.fs, options.config ?? getConfigPath());
    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);

    for (const fi of indexes) {
        if (fi.error) {
            ctx.logger.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const results = searchPlugins(indexes, query);

    if (options.json) {
        writeJson(jsonSuccess({
            results: results.map(r => ({
                name: r.name,
                version: r.entry.version,
                description: r.entry.description ?? null,
                repo: r.repoName,
            })),
        }));
        return;
    }

    if (results.length === 0) {
        ctx.logger.info(`No plugins found matching "${query}"`);
        return;
    }

    ctx.logger.info(`Search results for "${query}" (${results.length} found):\n`);
    for (const match of results) {
        const desc = match.entry.description ? ` — ${match.entry.description}` : "";
        ctx.logger.info(`  ${match.name}@${match.entry.version}${desc}`);
        ctx.logger.info(`    repo: ${match.repoName}`);
    }
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
