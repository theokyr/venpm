import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, getInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { ErrorCode, makeError } from "../core/errors.js";
import { findCandidates } from "../core/fuzzy.js";
import { createRealIOContext } from "./context.js";

export async function executeInfo(ctx: IOContext, pluginName: string, options: GlobalOptions = {}): Promise<void> {
    const { renderer } = ctx;
    const configPath = options.config ?? getConfigPath();
    const [config, lockfile] = await Promise.all([
        loadConfig(ctx.fs, configPath),
        loadLockfile(ctx.fs, getLockfilePath()),
    ]);

    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);

    for (const fi of indexes) {
        if (fi.error) {
            renderer.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const match = resolvePlugin(indexes, pluginName);
    const installedInfo = getInstalled(lockfile, pluginName);

    if (!match && !installedInfo) {
        const allPluginNames = indexes.flatMap(fi => Object.keys(fi.index?.plugins ?? {}));
        const candidates = findCandidates(pluginName, allPluginNames);
        renderer.error(makeError(ErrorCode.PLUGIN_NOT_FOUND, `Plugin "${pluginName}" not found in any index and is not installed`, { candidates }));
        renderer.finish(false);
        process.exitCode = 1;
        return;
    }

    const pairs: [string, string][] = [];
    pairs.push(["Plugin", pluginName]);

    if (match) {
        const { entry, repoName } = match;
        pairs.push(["Repository", repoName]);
        pairs.push(["Version", entry.version]);
        if (entry.description) pairs.push(["Description", entry.description]);
        if (entry.authors && entry.authors.length > 0) {
            pairs.push(["Authors", entry.authors.map(a => a.name).join(", ")]);
        }
        if (entry.license) pairs.push(["License", entry.license]);
        if (entry.dependencies && entry.dependencies.length > 0) {
            pairs.push(["Depends on", entry.dependencies.join(", ")]);
        }
        if (entry.discord) pairs.push(["Discord", entry.discord]);
        if (entry.vencord) pairs.push(["Vencord", entry.vencord]);
        const sourceKeys = Object.keys(entry.source).filter(k => entry.source[k as keyof typeof entry.source]);
        pairs.push(["Source", sourceKeys.join(", ")]);
        if (entry.versions) {
            pairs.push(["Versions", Object.keys(entry.versions).join(", ")]);
        }
    } else {
        pairs.push(["Index", "(not found in any currently reachable index)"]);
    }

    if (installedInfo) {
        pairs.push(["Installed", "yes"]);
        pairs.push(["Installed version", installedInfo.version]);
        pairs.push(["Method", installedInfo.method]);
        pairs.push(["Pinned", installedInfo.pinned ? "yes" : "no"]);
        pairs.push(["Installed at", installedInfo.installed_at]);
        if (installedInfo.git_ref) pairs.push(["Git ref", installedInfo.git_ref]);
    } else {
        pairs.push(["Installed", "no"]);
    }

    renderer.keyValue(pairs);

    const data = {
        name: pluginName,
        version: match?.entry.version ?? null,
        description: match?.entry.description ?? null,
        authors: match?.entry.authors ?? [],
        repo: match?.repoName ?? null,
        dependencies: match?.entry.dependencies ?? [],
        optionalDependencies: match?.entry.optionalDependencies ?? [],
        versions: match?.entry.versions ? Object.keys(match.entry.versions) : [],
        installed: !!installedInfo,
        installedVersion: installedInfo?.version ?? null,
    };
    renderer.finish(true, data);
}

export function registerInfoCommand(program: Command): void {
    program
        .command("info <plugin>")
        .description("Show details about a plugin")
        .action(async (plugin: string) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            await executeInfo(ctx, plugin, globalOpts);
        });
}
