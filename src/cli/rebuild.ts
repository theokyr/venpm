import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { detectVencordPath, detectDiscordBinary } from "../core/detect.js";
import { buildAndDeploy } from "../core/builder.js";
import { ErrorCode, makeError } from "../core/errors.js";
import { createRealIOContext } from "./context.js";

export function registerRebuildCommand(program: Command): void {
    program
        .command("rebuild")
        .description("Rebuild Vencord after plugin changes")
        .option("--no-restart", "Skip Discord restart without prompting")
        .option("--restart", "Restart Discord without prompting")
        .action(async (cmdOptions: { restart?: boolean; noRestart?: boolean }) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const { renderer } = ctx;
            const configPath = globalOpts.config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            // Resolve Vencord path
            const vencordPath = config.vencord.path ?? await detectVencordPath(ctx.fs);
            if (!vencordPath) {
                renderer.error(makeError(ErrorCode.VENCORD_NOT_FOUND, "Vencord path not found. Set vencord.path in config or $VENPM_VENCORD_PATH."));
                renderer.finish(false);
                process.exitCode = 1;
                return;
            }

            // Resolve Discord binary for optional restart
            const discordBinary = config.discord.binary ?? await detectDiscordBinary(ctx.fs);

            // Determine restart behaviour — explicit flags override config
            let shouldRestart = false;
            if (cmdOptions.noRestart) {
                shouldRestart = false;
            } else if (cmdOptions.restart) {
                shouldRestart = !!discordBinary;
            } else {
                const restartMode = config.discord.restart;
                if (restartMode === "always" && discordBinary) {
                    shouldRestart = true;
                } else if (restartMode === "ask" && discordBinary) {
                    shouldRestart = await ctx.prompter.confirm("Restart Discord after rebuild?", false);
                }
            }

            const p = renderer.progress("rebuild", `Building Vencord at ${vencordPath}...`);

            try {
                const result = await buildAndDeploy(ctx.fs, ctx.shell, vencordPath, {
                    restart: shouldRestart,
                    discordBinary: discordBinary ?? undefined,
                });

                p.succeed("Build complete");

                if (result.deployed && result.deployPath) {
                    renderer.text(`Deployed to ${result.deployPath}`);
                } else if (!result.deployed) {
                    renderer.warn("Deploy target not found — skipped copy step");
                }

                if (result.restarted) {
                    renderer.text("Discord restarted");
                }

                renderer.finish(true, {
                    built: true,
                    deployed: result.deployed,
                    restarted: result.restarted,
                });
            } catch (err) {
                p.fail("Build failed");
                renderer.error(makeError(ErrorCode.BUILD_FAILED, `Build failed: ${(err as Error).message}`));
                renderer.finish(false);
                process.exitCode = 1;
                return;
            }
        });
}
