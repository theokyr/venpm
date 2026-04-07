import { join } from "node:path";
import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, saveLockfile, isInstalled, removeInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { ErrorCode, makeError, exitCodeForError } from "../core/errors.js";
import { findCandidates } from "../core/fuzzy.js";
import { createRealIOContext } from "./context.js";

export async function executeUninstall(ctx: IOContext, pluginName: string, options: GlobalOptions): Promise<void> {
    const { renderer } = ctx;
    const configPath = options.config ?? getConfigPath();
    const lockfilePath = getLockfilePath();

    const config = await loadConfig(ctx.fs, configPath);
    let lockfile = await loadLockfile(ctx.fs, lockfilePath);

    if (!isInstalled(lockfile, pluginName)) {
        const installedNames = Object.keys(lockfile.installed);
        const candidates = findCandidates(pluginName, installedNames);
        renderer.error(makeError(ErrorCode.PLUGIN_NOT_INSTALLED, `Plugin "${pluginName}" is not installed.`, { candidates }));
        renderer.finish(false);
        process.exitCode = exitCodeForError(ErrorCode.PLUGIN_NOT_INSTALLED);
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
            renderer.warn(`"${other}" depends on this plugin`);
        }
    }

    const confirmed = await ctx.prompter.confirm(`Remove plugin "${pluginName}"?`, true);
    if (!confirmed) {
        renderer.text("Uninstall cancelled.");
        renderer.finish(false);
        return;
    }

    if (config.vencord.path !== null) {
        const pluginDir = join(config.vencord.path, "src", "userplugins", pluginName);
        await ctx.fs.rm(pluginDir, { recursive: true, force: true });
        renderer.success(`Removed plugin directory: ${pluginDir}`);
    }

    lockfile = removeInstalled(lockfile, pluginName);
    await saveLockfile(ctx.fs, lockfilePath, lockfile);

    renderer.success(`Uninstalled "${pluginName}".`);
    renderer.finish(true, { removed: pluginName });
}

export function registerUninstallCommand(program: Command): void {
    program
        .command("uninstall <plugin>")
        .description("Uninstall a plugin")
        .option("-y, --yes", "Skip confirmation prompt")
        .action(async (plugin: string, cmdOptions: { yes?: boolean }) => {
            const parentOpts = program.opts<GlobalOptions>();
            const globalOptions: GlobalOptions = {
                ...parentOpts,
                yes: parentOpts.yes || cmdOptions.yes,
            };
            const ctx = createRealIOContext(globalOptions);
            await executeUninstall(ctx, plugin, globalOptions);
        });
}
