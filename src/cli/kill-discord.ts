import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { killDiscordProcesses } from "../core/discord.js";
import { createRealIOContext } from "./context.js";

export function registerKillDiscordCommand(program: Command): void {
    program
        .command("kill-discord")
        .description("Kill all running Discord instances")
        .action(async () => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const { renderer } = ctx;
            const configPath = globalOpts.config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            const p = renderer.progress("kill", "Scanning for Discord processes...");

            const result = await killDiscordProcesses(
                ctx.fs,
                ctx.shell,
                config.discord.binary,
            );

            if (result.found.length === 0) {
                p.succeed("No Discord processes found");
                renderer.finish(true, { found: [], killed: 0, forced: 0 });
                return;
            }

            for (const proc of result.found) {
                renderer.dim(`  PID ${proc.pid} → ${proc.exe}`);
            }

            const totalKilled = result.killed.length + result.forced.length;

            if (result.forced.length > 0) {
                p.succeed(`Killed ${totalKilled} Discord process(es) (${result.forced.length} required SIGKILL)`);
            } else {
                p.succeed(`Killed ${totalKilled} Discord process(es)`);
            }

            renderer.finish(true, {
                found: result.found,
                killed: totalKilled,
                forced: result.forced.length,
            });
        });
}
