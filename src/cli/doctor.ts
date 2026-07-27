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
import { resolveLaunchPlan, readSessionEnv, type Platform } from "../core/launch.js";
import { createRealIOContext } from "./context.js";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { version: venpmVersion } = _require("../../package.json") as { version: string };

export function registerDoctorCommand(program: Command): void {
    program
        .command("doctor")
        .description("Check venpm environment and configuration")
        .action(async () => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const { renderer } = ctx;
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

            const ok = "\u2713";
            const fail = "\u2717";
            const warn = "~";

            // Determine Vencord path status
            let vencordStatus: string;
            let vencordSigil: string;
            if (configuredVencordPath) {
                const exists = await ctx.fs.exists(configuredVencordPath);
                vencordSigil = exists ? ok : fail;
                vencordStatus = `${configuredVencordPath} (config)${exists ? "" : " [not found]"}`;
            } else if (detectedVencordPath) {
                vencordSigil = warn;
                vencordStatus = `${detectedVencordPath} (auto-detected)`;
            } else {
                vencordSigil = fail;
                vencordStatus = "not found";
            }

            // Determine Discord binary status
            let discordStatus: string;
            let discordSigil: string;
            if (configuredBinary) {
                const exists = await ctx.fs.exists(configuredBinary);
                discordSigil = exists ? ok : fail;
                discordStatus = `${configuredBinary} (config)${exists ? "" : " [not found]"}`;
            } else if (detectedBinary) {
                discordSigil = warn;
                discordStatus = `${detectedBinary} (auto-detected)`;
            } else {
                discordSigil = fail;
                discordStatus = "not found";
            }

            // Can this shell actually launch Discord? Agent and CI shells often
            // cannot, and finding out during a restart is far too late.
            const platform = process.platform as Platform;
            let plan = resolveLaunchPlan(platform, process.env, discordBinary ?? "discord");
            if (platform === "linux" && !process.env["DISPLAY"]) {
                // Same fallback a restart would take, so doctor reports reality.
                plan = resolveLaunchPlan(
                    platform,
                    process.env,
                    discordBinary ?? "discord",
                    await readSessionEnv(ctx.shell),
                );
            }
            const launchSigil = plan.problem ? fail : ok;
            const launchStatus = plan.problem ?? plan.note ?? "can launch Discord";

            renderer.keyValue([
                [`${gitOk ? ok : fail} git`, gitOk ? "available" : "not found"],
                [`${pnpmOk ? ok : fail} pnpm`, pnpmOk ? "available" : "not found"],
                [`${vencordSigil} Vencord path`, vencordStatus],
                [`${discordSigil} Discord binary`, discordStatus],
                [`${launchSigil} Launch environment`, launchStatus],
                [`${repoCount > 0 ? ok : warn} Repositories`, `${repoCount} configured`],
                [`${ok} venpm`, venpmVersion],
            ]);

            renderer.finish(true, {
                git: gitOk,
                pnpm: pnpmOk,
                vencordPath,
                discordBinary,
                canLaunchDiscord: plan.problem === null,
                launchProblem: plan.problem,
                launchArgs: plan.args,
                repos: repoCount,
                venpmVersion,
            });
        });
}
