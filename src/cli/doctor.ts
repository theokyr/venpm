import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import {
    detectVencordPath,
    detectDiscordBinary,
    checkGitAvailable,
    checkPnpmAvailable,
} from "../core/detect.js";
import { jsonSuccess, writeJson } from "../core/json.js";
import { createRealIOContext } from "./context.js";

export function registerDoctorCommand(program: Command): void {
    program
        .command("doctor")
        .description("Check venpm environment and configuration")
        .action(async () => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const configPath = globalOpts.config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            // Collect all check results
            const gitOk = await checkGitAvailable(ctx.shell);
            const pnpmOk = await checkPnpmAvailable(ctx.shell);

            const configuredVencordPath = config.vencord.path;
            const detectedVencordPath = configuredVencordPath ? null : await detectVencordPath(ctx.fs);
            const vencordPath = configuredVencordPath ?? detectedVencordPath ?? null;

            const configuredBinary = config.discord.binary;
            const detectedBinary = configuredBinary ? null : await detectDiscordBinary(ctx.fs);
            const discordBinary = configuredBinary ?? detectedBinary ?? null;

            const repoCount = config.repos.length;

            if (globalOpts.json) {
                writeJson(jsonSuccess({
                    git: gitOk,
                    pnpm: pnpmOk,
                    vencordPath,
                    discordBinary,
                    repos: repoCount,
                    venpmVersion: "0.1.0",
                }));
                return;
            }

            const ok = "✓";
            const fail = "✗";
            const warn = "~";

            console.log(`${gitOk ? ok : fail} git: ${gitOk ? "available" : "not found"}`);
            console.log(`${pnpmOk ? ok : fail} pnpm: ${pnpmOk ? "available" : "not found"}`);

            if (configuredVencordPath) {
                const exists = await ctx.fs.exists(configuredVencordPath);
                console.log(`${exists ? ok : fail} Vencord path (config): ${configuredVencordPath}${exists ? "" : " (not found)"}`);
            } else if (detectedVencordPath) {
                console.log(`${warn} Vencord path (auto-detected): ${detectedVencordPath}`);
            } else {
                console.log(`${fail} Vencord path: not found (set vencord.path in config or $VENPM_VENCORD_PATH)`);
            }

            if (configuredBinary) {
                const exists = await ctx.fs.exists(configuredBinary);
                console.log(`${exists ? ok : fail} Discord binary (config): ${configuredBinary}${exists ? "" : " (not found)"}`);
            } else if (detectedBinary) {
                console.log(`${warn} Discord binary (auto-detected): ${detectedBinary}`);
            } else {
                console.log(`${fail} Discord binary: not found (set discord.binary in config)`);
            }

            console.log(`${repoCount > 0 ? ok : warn} Repositories: ${repoCount} configured`);
        });
}
