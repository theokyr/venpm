import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { detectVencordPath, detectDiscordBinary } from "../core/detect.js";
import { buildAndDeploy, restartDiscord } from "../core/builder.js";
import { ErrorCode, makeError, exitCodeForError } from "../core/errors.js";
import { createRealIOContext } from "./context.js";
import { createPnpmEnvForNonInteractiveYes } from "./pnpm-env.js";

export function registerRebuildCommand(program: Command): void {
    program
        .command("rebuild")
        .description("Rebuild Vencord after plugin changes")
        .option("--no-restart", "Skip Discord restart without prompting")
        .option("--restart", "Restart Discord without prompting")
        .action(async (cmdOptions: { restart?: boolean }) => {
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
                process.exitCode = exitCodeForError(ErrorCode.VENCORD_NOT_FOUND);
                return;
            }

            // Resolve Discord binary for optional restart
            const discordBinary = config.discord.binary ?? await detectDiscordBinary(ctx.fs);

            // Determine restart behaviour — explicit flags override config
            let shouldRestart = false;
            if (cmdOptions.restart === false) {
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

            // Build and deploy first, restart second: a restart failure must not be
            // reported as a build failure, and the deploy is still valid without it.
            let result: Awaited<ReturnType<typeof buildAndDeploy>>;
            try {
                result = await buildAndDeploy(ctx.fs, ctx.shell, vencordPath, {
                    pnpmEnv: createPnpmEnvForNonInteractiveYes(globalOpts),
                });

                p.succeed("Build complete");

                if (result.deployed && result.deployPath) {
                    renderer.text(`Deployed to ${result.deployPath}`);
                } else if (!result.deployed) {
                    renderer.warn("Deploy target not found — skipped copy step");
                }

            } catch (err) {
                p.fail("Build failed");
                renderer.error(makeError(ErrorCode.BUILD_FAILED, `Build failed: ${(err as Error).message}`));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.BUILD_FAILED);
                return;
            }

            if (!shouldRestart || !discordBinary) {
                renderer.finish(true, { built: true, deployed: result.deployed, restarted: false, restartedPids: [] });
                return;
            }

            const rp = renderer.progress("restart", "Restarting Discord...");
            try {
                const verification = await restartDiscord(ctx.fs, ctx.shell, discordBinary);
                const pids = verification.pids.length ? ` (PID ${verification.pids.join(", ")})` : "";
                rp.succeed(`Discord restarted and verified running${pids}`);
                renderer.finish(true, {
                    built: true,
                    deployed: result.deployed,
                    restarted: true,
                    restartedPids: verification.pids,
                });
            } catch (err) {
                rp.fail("Discord restart failed");
                renderer.error(makeError(ErrorCode.RESTART_FAILED, (err as Error).message));
                renderer.finish(false, {
                    built: true,
                    deployed: result.deployed,
                    restarted: false,
                    restartedPids: [],
                });
                process.exitCode = exitCodeForError(ErrorCode.RESTART_FAILED);
            }
        });
}
