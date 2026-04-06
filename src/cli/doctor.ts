import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import {
    detectVencordPath,
    detectDiscordBinary,
    checkGitAvailable,
    checkPnpmAvailable,
} from "../core/detect.js";
import { createRealIOContext } from "./context.js";

export function registerDoctorCommand(program: Command): void {
    program
        .command("doctor")
        .description("Check venpm environment and configuration")
        .action(async () => {
            const ctx = createRealIOContext(program.opts());
            const configPath = program.opts().config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            const ok = "✓";
            const fail = "✗";
            const warn = "~";

            // git
            const gitOk = await checkGitAvailable(ctx.shell);
            console.log(`${gitOk ? ok : fail} git: ${gitOk ? "available" : "not found"}`);

            // pnpm
            const pnpmOk = await checkPnpmAvailable(ctx.shell);
            console.log(`${pnpmOk ? ok : fail} pnpm: ${pnpmOk ? "available" : "not found"}`);

            // Vencord path
            const configuredVencordPath = config.vencord.path;
            if (configuredVencordPath) {
                const exists = await ctx.fs.exists(configuredVencordPath);
                console.log(`${exists ? ok : fail} Vencord path (config): ${configuredVencordPath}${exists ? "" : " (not found)"}`);
            } else {
                const detected = await detectVencordPath(ctx.fs);
                if (detected) {
                    console.log(`${warn} Vencord path (auto-detected): ${detected}`);
                } else {
                    console.log(`${fail} Vencord path: not found (set vencord.path in config or $VENPM_VENCORD_PATH)`);
                }
            }

            // Discord binary
            const configuredBinary = config.discord.binary;
            if (configuredBinary) {
                const exists = await ctx.fs.exists(configuredBinary);
                console.log(`${exists ? ok : fail} Discord binary (config): ${configuredBinary}${exists ? "" : " (not found)"}`);
            } else {
                const detected = await detectDiscordBinary(ctx.fs);
                if (detected) {
                    console.log(`${warn} Discord binary (auto-detected): ${detected}`);
                } else {
                    console.log(`${fail} Discord binary: not found (set discord.binary in config)`);
                }
            }

            // Repos
            const repoCount = config.repos.length;
            console.log(`${repoCount > 0 ? ok : warn} Repositories: ${repoCount} configured`);
        });
}
