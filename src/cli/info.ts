import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, getInstalled } from "../core/lockfile.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { createRealIOContext } from "./context.js";

export async function executeInfo(ctx: IOContext, pluginName: string, options: GlobalOptions = {}): Promise<void> {
    const configPath = options.config ?? getConfigPath();
    const [config, lockfile] = await Promise.all([
        loadConfig(ctx.fs, configPath),
        loadLockfile(ctx.fs, getLockfilePath()),
    ]);

    const indexes = await fetchAllIndexes(ctx.http, config.repos);

    for (const fi of indexes) {
        if (fi.error) {
            ctx.logger.warn(`Failed to fetch index from "${fi.repoName}": ${fi.error}`);
        }
    }

    const match = resolvePlugin(indexes, pluginName);
    const installedInfo = getInstalled(lockfile, pluginName);

    if (!match && !installedInfo) {
        ctx.logger.error(`Plugin "${pluginName}" not found in any index and is not installed`);
        return;
    }

    ctx.logger.info(`Plugin: ${pluginName}\n`);

    if (match) {
        const { entry, repoName } = match;
        ctx.logger.info(`  Repository:  ${repoName}`);
        ctx.logger.info(`  Version:     ${entry.version}`);
        if (entry.description) {
            ctx.logger.info(`  Description: ${entry.description}`);
        }
        if (entry.authors && entry.authors.length > 0) {
            const authorList = entry.authors.map(a => a.name).join(", ");
            ctx.logger.info(`  Authors:     ${authorList}`);
        }
        if (entry.license) {
            ctx.logger.info(`  License:     ${entry.license}`);
        }
        if (entry.dependencies && entry.dependencies.length > 0) {
            ctx.logger.info(`  Depends on:  ${entry.dependencies.join(", ")}`);
        }
        if (entry.discord) {
            ctx.logger.info(`  Discord:     ${entry.discord}`);
        }
        if (entry.vencord) {
            ctx.logger.info(`  Vencord:     ${entry.vencord}`);
        }
        const sourceKeys = Object.keys(entry.source).filter(k => entry.source[k as keyof typeof entry.source]);
        ctx.logger.info(`  Source:      ${sourceKeys.join(", ")}`);
        if (entry.versions) {
            const versionList = Object.keys(entry.versions).join(", ");
            ctx.logger.info(`  Versions:    ${versionList}`);
        }
    } else {
        ctx.logger.warn(`  (Plugin not found in any currently reachable index)`);
    }

    if (installedInfo) {
        ctx.logger.info(`\n  Installed:`);
        ctx.logger.info(`    Version:      ${installedInfo.version}`);
        ctx.logger.info(`    Method:       ${installedInfo.method}`);
        ctx.logger.info(`    Pinned:       ${installedInfo.pinned ? "yes" : "no"}`);
        ctx.logger.info(`    Installed at: ${installedInfo.installed_at}`);
        if (installedInfo.git_ref) {
            ctx.logger.info(`    Git ref:      ${installedInfo.git_ref}`);
        }
    } else {
        ctx.logger.info(`\n  Not installed.`);
    }
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
