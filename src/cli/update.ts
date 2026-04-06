import { join } from "node:path";
import type { Command } from "commander";
import type { IOContext, GlobalOptions, InstallPlanEntry } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, saveLockfile, getInstalled, addInstalled, removeInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { fetchPlugin } from "../core/fetcher.js";
import { jsonSuccess, jsonError, writeJson } from "../core/json.js";
import { createRealIOContext } from "./context.js";
import { selectMethodFromSource } from "../core/resolver.js";

export async function executeUpdate(ctx: IOContext, pluginName: string | undefined, options: GlobalOptions): Promise<void> {
    const configPath = options.config ?? getConfigPath();
    const lockfilePath = getLockfilePath();

    const config = await loadConfig(ctx.fs, configPath);
    let lockfile = await loadLockfile(ctx.fs, lockfilePath);

    const installedEntries = Object.entries(lockfile.installed);

    if (installedEntries.length === 0) {
        ctx.logger.info("No plugins installed.");
        return;
    }

    // Determine which plugins to update
    let targets: string[];
    if (pluginName !== undefined) {
        const info = getInstalled(lockfile, pluginName);
        if (!info) {
            if (options.json) {
                writeJson(jsonError(`Plugin "${pluginName}" is not installed.`));
                return;
            }
            ctx.logger.error(`Plugin "${pluginName}" is not installed.`);
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
            ctx.logger.info(`Skipping pinned plugin: ${name}`);
            return false;
        }
        if (info.method === "local") {
            ctx.logger.info(`Skipping local plugin: ${name}`);
            return false;
        }
        return true;
    });

    if (updateable.length === 0) {
        ctx.logger.info("Nothing to update.");
        return;
    }

    const cache = await loadCache(ctx.fs);
    const { results: indexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);

    for (const fi of indexes) {
        if (fi.error) {
            ctx.logger.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const gitAvailable = await ctx.git.available();

    let updatedCount = 0;
    const updatedEntries: { name: string; from: string; to: string }[] = [];
    const skippedNames: string[] = [];

    for (const name of updateable) {
        const installedInfo = getInstalled(lockfile, name)!;
        const match = resolvePlugin(indexes, name, installedInfo.repo);

        if (!match) {
            ctx.logger.warn(`Plugin "${name}" not found in repo "${installedInfo.repo}" — skipping`);
            skippedNames.push(name);
            continue;
        }

        const latestVersion = match.entry.version;

        if (latestVersion === installedInfo.version) {
            ctx.logger.verbose(`${name} is up to date (${installedInfo.version})`);
            skippedNames.push(name);
            continue;
        }

        ctx.logger.info(`Updating ${name}: ${installedInfo.version} → ${latestVersion}`);

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

        ctx.logger.success(`Updated ${name} to ${latestVersion}`);
        updatedEntries.push({ name, from: installedInfo.version, to: latestVersion });
        updatedCount++;
    }

    await saveLockfile(ctx.fs, lockfilePath, lockfile);

    if (options.json) {
        writeJson(jsonSuccess({ updated: updatedEntries, skipped: skippedNames }));
        return;
    }

    if (updatedCount === 0) {
        ctx.logger.info("All plugins are up to date.");
    } else {
        ctx.logger.success(`Updated ${updatedCount} plugin(s).`);
    }
}

export function registerUpdateCommand(program: Command): void {
    program
        .command("update [plugin]")
        .description("Update a plugin or all plugins")
        .action(async (plugin: string | undefined) => {
            const parentOpts = program.opts<{ config?: string; verbose?: boolean; yes?: boolean }>();
            const globalOptions: GlobalOptions = {
                config: parentOpts.config,
                verbose: parentOpts.verbose,
            };
            const ctx = createRealIOContext({ ...globalOptions, yes: parentOpts.yes });
            await executeUpdate(ctx, plugin, globalOptions);
        });
}
