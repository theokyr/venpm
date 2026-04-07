import { join } from "node:path";
import type { Command } from "commander";
import type { IOContext, GlobalOptions, InstallPlanEntry } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, saveLockfile, getInstalled, addInstalled, removeInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { fetchPlugin } from "../core/fetcher.js";
import { ErrorCode, makeError } from "../core/errors.js";
import { findCandidates } from "../core/fuzzy.js";
import { createRealIOContext } from "./context.js";
import { selectMethodFromSource } from "../core/resolver.js";

export async function executeUpdate(ctx: IOContext, pluginName: string | undefined, options: GlobalOptions): Promise<void> {
    const { renderer } = ctx;
    const configPath = options.config ?? getConfigPath();
    const lockfilePath = getLockfilePath();

    const config = await loadConfig(ctx.fs, configPath);
    let lockfile = await loadLockfile(ctx.fs, lockfilePath);

    const installedEntries = Object.entries(lockfile.installed);

    if (installedEntries.length === 0) {
        renderer.text("No plugins installed.");
        renderer.finish(true, { updated: [], skipped: [] });
        return;
    }

    // Determine which plugins to update
    let targets: string[];
    if (pluginName !== undefined) {
        const info = getInstalled(lockfile, pluginName);
        if (!info) {
            const installedNames = Object.keys(lockfile.installed);
            const candidates = findCandidates(pluginName, installedNames);
            renderer.error(makeError(ErrorCode.PLUGIN_NOT_INSTALLED, `Plugin "${pluginName}" is not installed.`, { candidates }));
            renderer.finish(false);
            process.exitCode = 1;
            return;
        }
        targets = [pluginName];
    } else {
        targets = installedEntries.map(([name]) => name);
    }

    // Filter out pinned and local plugins
    const updateable = targets.filter(name => {
        const info = getInstalled(lockfile, name)!;
        if (info.pinned) {
            renderer.verbose(`Skipping pinned plugin: ${name}`);
            return false;
        }
        if (info.method === "local") {
            renderer.verbose(`Skipping local plugin: ${name}`);
            return false;
        }
        return true;
    });

    if (updateable.length === 0) {
        renderer.text("Nothing to update.");
        renderer.finish(true, { updated: [], skipped: [] });
        return;
    }

    const p = renderer.progress("fetch-indexes", "Fetching indexes...");
    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);
    p.succeed(`${indexes.filter(fi => fi.index).length} repo(s) fetched`);

    for (const fi of indexes) {
        if (fi.error) {
            renderer.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const gitAvailable = await ctx.git.available();

    let updatedCount = 0;
    const updatedResults: { name: string; from: string; to: string }[] = [];
    const skippedNames: string[] = [];

    for (const name of updateable) {
        const installedInfo = getInstalled(lockfile, name)!;
        const match = resolvePlugin(indexes, name, installedInfo.repo);

        if (!match) {
            renderer.warn(`Plugin "${name}" not found in repo "${installedInfo.repo}" — skipping`);
            skippedNames.push(name);
            continue;
        }

        const latestVersion = match.entry.version;

        if (latestVersion === installedInfo.version) {
            renderer.verbose(`${name} is up to date (${installedInfo.version})`);
            skippedNames.push(name);
            continue;
        }

        const up = renderer.progress(`update-${name}`, `Updating ${name}: ${installedInfo.version} → ${latestVersion}`);

        // Remove old plugin directory if vencord.path is configured
        if (config.vencord.path !== null) {
            const oldDir = join(config.vencord.path, "src", "userplugins", name);
            await ctx.fs.rm(oldDir, { recursive: true, force: true });
        }

        // Remove from lockfile before re-fetching
        lockfile = removeInstalled(lockfile, name);

        // Resolve fetch method from current source metadata
        const resolvedMethod = selectMethodFromSource(match.entry.source, gitAvailable);

        // Fetch the new version
        const planEntry: InstallPlanEntry = {
            name,
            version: latestVersion,
            repo: match.repoName,
            source: match.entry.source,
            method: resolvedMethod,
            isDependency: false,
        };

        if (config.vencord.path !== null) {
            const userpluginDir = join(config.vencord.path, "src", "userplugins");
            const fetchResult = await fetchPlugin(planEntry, userpluginDir, ctx);

            lockfile = addInstalled(lockfile, name, {
                version: latestVersion,
                repo: match.repoName,
                method: fetchResult.method,
                pinned: false,
                git_ref: fetchResult.git_ref,
                installed_at: new Date().toISOString(),
                path: fetchResult.path,
            });
        } else {
            // No vencord path configured — just update lockfile version
            lockfile = addInstalled(lockfile, name, {
                ...installedInfo,
                version: latestVersion,
            });
        }

        up.succeed(`${name}: ${installedInfo.version} → ${latestVersion}`);
        updatedResults.push({ name, from: installedInfo.version, to: latestVersion });
        updatedCount++;
    }

    await saveLockfile(ctx.fs, lockfilePath, lockfile);

    if (updatedCount === 0) {
        renderer.text("All plugins are up to date.");
    } else {
        renderer.success(`Updated ${updatedCount} plugin(s).`);
    }

    renderer.finish(true, { updated: updatedResults, skipped: skippedNames });
}

export function registerUpdateCommand(program: Command): void {
    program
        .command("update [plugin]")
        .description("Update a plugin or all plugins")
        .action(async (plugin: string | undefined) => {
            const globalOptions = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOptions);
            await executeUpdate(ctx, plugin, globalOptions);
        });
}
