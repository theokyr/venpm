import { join } from "node:path";
import type { Command } from "commander";
import type { IOContext, GlobalOptions, InstallPlanEntry } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, saveLockfile, getInstalled, addInstalled, removeInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { fetchPlugin } from "../core/fetcher.js";
import { createRealIOContext } from "./context.js";

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
            ctx.logger.error(`Plugin "${pluginName}" is not installed.`);
            process.exit(1);
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

    const indexes = await fetchAllIndexes(ctx.http, config.repos);

    for (const fi of indexes) {
        if (fi.error) {
            ctx.logger.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const gitAvailable = await ctx.git.available();

    let updatedCount = 0;

    for (const name of updateable) {
        const installedInfo = getInstalled(lockfile, name)!;
        const match = resolvePlugin(indexes, name, installedInfo.repo);

        if (!match) {
            ctx.logger.warn(`Plugin "${name}" not found in repo "${installedInfo.repo}" — skipping`);
            continue;
        }

        const latestVersion = match.entry.version;

        if (latestVersion === installedInfo.version) {
            ctx.logger.verbose(`${name} is up to date (${installedInfo.version})`);
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

        // Fetch the new version
        const planEntry: InstallPlanEntry = {
            name,
            version: latestVersion,
            repo: match.repoName,
            source: match.entry.source,
            method: installedInfo.method,
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
        updatedCount++;
    }

    await saveLockfile(ctx.fs, lockfilePath, lockfile);

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
            const globalOptions: GlobalOptions = {
                config: program.opts<{ config?: string }>().config,
                verbose: program.opts<{ verbose?: boolean }>().verbose,
                noColor: program.opts<{ noColor?: boolean }>().noColor,
            };
            const ctx = createRealIOContext(globalOptions);
            await executeUpdate(ctx, plugin, globalOptions);
        });
}
