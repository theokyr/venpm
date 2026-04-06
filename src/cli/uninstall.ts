import { join } from "node:path";
import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, saveLockfile, isInstalled, removeInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { createRealIOContext } from "./context.js";

export async function executeUninstall(ctx: IOContext, pluginName: string, options: GlobalOptions): Promise<void> {
    const configPath = options.config ?? getConfigPath();
    const lockfilePath = getLockfilePath();

    const config = await loadConfig(ctx.fs, configPath);
    let lockfile = await loadLockfile(ctx.fs, lockfilePath);

    if (!isInstalled(lockfile, pluginName)) {
        ctx.logger.error(`Plugin "${pluginName}" is not installed.`);
        process.exitCode = 1;
        return;
    }

    // Warn if other installed plugins depend on this one
    const cache = await loadCache(ctx.fs);
    const { results: fetchedIndexes, updatedCache } = await fetchAllIndexes(ctx.http, config.repos, { cache });
    await saveCache(ctx.fs, updatedCache);
    const otherInstalled = Object.keys(lockfile.installed).filter(n => n !== pluginName);
    for (const other of otherInstalled) {
        const match = resolvePlugin(fetchedIndexes, other);
        if (match?.entry.dependencies?.includes(pluginName)) {
            ctx.logger.warn(`"${other}" depends on this plugin`);
        }
    }

    const confirmed = await ctx.prompter.confirm(`Remove plugin "${pluginName}"?`, true);
    if (!confirmed) {
        ctx.logger.info("Uninstall cancelled.");
        return;
    }

    if (config.vencord.path !== null) {
        const pluginDir = join(config.vencord.path, "src", "userplugins", pluginName);
        await ctx.fs.rm(pluginDir, { recursive: true, force: true });
        ctx.logger.success(`Removed plugin directory: ${pluginDir}`);
    }

    lockfile = removeInstalled(lockfile, pluginName);
    await saveLockfile(ctx.fs, lockfilePath, lockfile);
    ctx.logger.success(`Uninstalled "${pluginName}".`);
}

export function registerUninstallCommand(program: Command): void {
    program
        .command("uninstall <plugin>")
        .description("Uninstall a plugin")
        .option("-y, --yes", "Skip confirmation prompt")
        .action(async (plugin: string, cmdOptions: { yes?: boolean }) => {
            const parentOpts = program.opts<{ config?: string; verbose?: boolean; yes?: boolean }>();
            const globalOptions: GlobalOptions = {
                config: parentOpts.config,
                verbose: parentOpts.verbose,
            };
            const ctx = createRealIOContext({ ...globalOptions, yes: parentOpts.yes || cmdOptions.yes });
            await executeUninstall(ctx, plugin, globalOptions);
        });
}
