import type { Command } from "commander";
import { loadConfig, saveConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { createRealIOContext } from "./context.js";

export function registerRepoCommand(program: Command): void {
    const repo = program
        .command("repo")
        .description("Manage plugin repositories");

    repo
        .command("add <url>")
        .description("Add a plugin repository")
        .option("-n, --name <alias>", "Alias for the repository")
        .action(async (url: string, options: { name?: string }) => {
            const ctx = createRealIOContext(program.opts());
            const configPath = program.opts().config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            let name = options.name;
            if (!name) {
                try {
                    name = new URL(url).hostname.replace(/^www\./, "");
                } catch {
                    name = url;
                }
            }

            const existing = config.repos.find(r => r.name === name);
            if (existing) {
                ctx.logger.error(`Repository with name "${name}" already exists (${existing.url})`);
                process.exit(1);
            }

            config.repos.push({ name, url });
            await saveConfig(ctx.fs, configPath, config);
            ctx.logger.success(`Added repository "${name}" → ${url}`);
        });

    repo
        .command("remove <name>")
        .description("Remove a plugin repository by name")
        .action(async (name: string) => {
            const ctx = createRealIOContext(program.opts());
            const configPath = program.opts().config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            const index = config.repos.findIndex(r => r.name === name);
            if (index === -1) {
                ctx.logger.error(`Repository "${name}" not found`);
                process.exit(1);
            }

            config.repos.splice(index, 1);
            await saveConfig(ctx.fs, configPath, config);
            ctx.logger.success(`Removed repository "${name}"`);
        });

    repo
        .command("list")
        .description("List all configured repositories")
        .action(async () => {
            const ctx = createRealIOContext(program.opts());
            const configPath = program.opts().config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            if (config.repos.length === 0) {
                ctx.logger.info("No repositories configured");
                return;
            }

            ctx.logger.info(`Configured repositories (${config.repos.length}):\n`);
            for (const r of config.repos) {
                ctx.logger.info(`  ${r.name}  ${r.url}`);
            }
        });
}
