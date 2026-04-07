import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { ErrorCode, makeError, exitCodeForError } from "../core/errors.js";
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
            const parentOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(parentOpts);
            const { renderer } = ctx;
            const configPath = parentOpts.config ?? getConfigPath();
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
                renderer.error(makeError(ErrorCode.REPO_FETCH_FAILED, `Repository with name "${name}" already exists (${existing.url})`));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.REPO_FETCH_FAILED);
                return;
            }

            config.repos.push({ name, url });
            await saveConfig(ctx.fs, configPath, config);

            renderer.success(`Added repository "${name}" → ${url}`);
            renderer.finish(true, { name, url });
        });

    repo
        .command("remove <name>")
        .description("Remove a plugin repository by name")
        .action(async (name: string) => {
            const parentOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(parentOpts);
            const { renderer } = ctx;
            const configPath = parentOpts.config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            const index = config.repos.findIndex(r => r.name === name);
            if (index === -1) {
                const repoNames = config.repos.map(r => r.name);
                renderer.error(makeError(ErrorCode.REPO_FETCH_FAILED, `Repository "${name}" not found`, {
                    candidates: repoNames.length > 0 ? repoNames : undefined,
                }));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.REPO_FETCH_FAILED);
                return;
            }

            config.repos.splice(index, 1);
            await saveConfig(ctx.fs, configPath, config);

            renderer.success(`Removed repository "${name}"`);
            renderer.finish(true, { removed: name });
        });

    repo
        .command("list")
        .description("List all configured repositories")
        .action(async () => {
            const parentOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(parentOpts);
            const { renderer } = ctx;
            const configPath = parentOpts.config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            if (config.repos.length === 0) {
                renderer.text("No repositories configured");
                renderer.finish(true, { repos: [] });
                return;
            }

            renderer.heading(`Configured repositories (${config.repos.length})`);
            renderer.table(
                ["Name", "URL"],
                config.repos.map(r => [r.name, r.url]),
            );

            renderer.finish(true, { repos: config.repos.map(r => ({ name: r.name, url: r.url })) });
        });
}
