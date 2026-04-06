import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { detectVencordPath, detectDiscordBinary } from "../core/detect.js";
import { buildAndDeploy } from "../core/builder.js";
import { createRealIOContext } from "./context.js";

export function registerRebuildCommand(program: Command): void {
    program
        .command("rebuild")
        .description("Rebuild Vencord after plugin changes")
        .action(async () => {
            const ctx = createRealIOContext(program.opts());
            const configPath = program.opts().config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            // Resolve Vencord path
            const vencordPath = config.vencord.path ?? await detectVencordPath(ctx.fs);
            if (!vencordPath) {
                ctx.logger.error("Vencord path not found. Set vencord.path in config or $VENPM_VENCORD_PATH.");
                process.exitCode = 1;
                return;
            }

            // Resolve Discord binary for optional restart
            const discordBinary = config.discord.binary ?? await detectDiscordBinary(ctx.fs);

            // Determine restart behaviour
            let shouldRestart = false;
            const restartMode = config.discord.restart;

            if (restartMode === "always" && discordBinary) {
                shouldRestart = true;
            } else if (restartMode === "ask" && discordBinary) {
                shouldRestart = await ctx.prompter.confirm("Restart Discord after rebuild?", false);
            }

            ctx.logger.info(`Building Vencord at ${vencordPath}...`);

            try {
                const result = await buildAndDeploy(ctx.fs, ctx.shell, vencordPath, {
                    restart: shouldRestart,
                    discordBinary: discordBinary ?? undefined,
                });

                ctx.logger.success("Build complete");

                if (result.deployed && result.deployPath) {
                    ctx.logger.info(`Deployed to ${result.deployPath}`);
                } else if (!result.deployed) {
                    ctx.logger.warn("Deploy target not found — skipped copy step");
                }

                if (shouldRestart && discordBinary) {
                    ctx.logger.info("Discord restarted");
                }
            } catch (err) {
                ctx.logger.error(`Build failed: ${(err as Error).message}`);
                process.exitCode = 1;
                return;
            }
        });
}
