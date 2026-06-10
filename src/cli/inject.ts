import type { Command } from "commander";
import type { GlobalOptions, RestartMode } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { getConfigPath } from "../core/paths.js";
import { detectDiscordBinary } from "../core/detect.js";
import { restartDiscord } from "../core/builder.js";
import {
    DISCORD_BRANCHES,
    detectDiscordApps,
    getInjectStatus,
    injectVencord,
    uninjectVencord,
    InjectError,
    type DiscordBranch,
    type InjectTarget,
} from "../core/inject.js";
import { ErrorCode, makeError, exitCodeForError, type ErrorCodeValue } from "../core/errors.js";
import { createRealIOContext } from "./context.js";

interface InjectCmdOptions {
    branch?: string;
    restart?: boolean;
}

function supportsNativeInject(platform: NodeJS.Platform): boolean {
    return platform === "darwin" || platform === "linux";
}

function mapInjectErrorCode(code: InjectError["code"]): ErrorCodeValue {
    switch (code) {
        case "PLATFORM_UNSUPPORTED": return ErrorCode.PLATFORM_UNSUPPORTED;
        case "DISCORD_NOT_FOUND":    return ErrorCode.DISCORD_NOT_FOUND;
        case "ALREADY_INJECTED":     return ErrorCode.ALREADY_INJECTED;
        case "NOT_INJECTED":         return ErrorCode.NOT_INJECTED;
        case "INJECT_FAILED":        return ErrorCode.INJECT_FAILED;
    }
}

const MACOS_APP_MANAGEMENT_SUGGESTION =
    "Grant App Management permission to your terminal in System Settings > Privacy & Security > App Management, then run venpm inject again.";

export function appManagementSuggestionForInjectError(err: Error): string | undefined {
    if (process.platform !== "darwin") return undefined;
    if (!("code" in err) || err.code !== "EPERM") return undefined;
    if (!err.message.includes("/Applications/") || !err.message.includes(".app/Contents/Resources/")) {
        return undefined;
    }

    return MACOS_APP_MANAGEMENT_SUGGESTION;
}

async function resolveTarget(
    fs: Parameters<typeof detectDiscordApps>[0],
    branch: string | undefined,
): Promise<InjectTarget | { error: ErrorCodeValue; message: string }> {
    const apps = await detectDiscordApps(fs);

    if (apps.length === 0) {
        if (!supportsNativeInject(process.platform)) {
            return {
                error: ErrorCode.PLATFORM_UNSUPPORTED,
                message: `Native inject is not supported on ${process.platform}`,
            };
        }
        return {
            error: ErrorCode.DISCORD_NOT_FOUND,
            message: process.platform === "darwin"
                ? "No Discord.app found in /Applications"
                : "No Discord install found in standard Linux paths",
        };
    }

    if (!branch) {
        // Default: stable if present, otherwise first detected
        const stable = apps.find(a => a.branch === "stable");
        return stable ?? apps[0];
    }

    const requested = branch.toLowerCase() as DiscordBranch;
    if (!DISCORD_BRANCHES.includes(requested)) {
        return {
            error: ErrorCode.DISCORD_NOT_FOUND,
            message: `Unknown branch '${branch}'. Expected one of: ${DISCORD_BRANCHES.join(", ")}`,
        };
    }

    const match = apps.find(a => a.branch === requested);
    if (!match) {
        return {
            error: ErrorCode.DISCORD_NOT_FOUND,
            message: process.platform === "darwin"
                ? `Discord ${requested} not found in /Applications`
                : `Discord ${requested} not found in standard Linux paths`,
        };
    }
    return match;
}

export async function shouldRestartAfterInject(
    options: Pick<InjectCmdOptions, "restart">,
    restartMode: RestartMode,
    discordBinary: string | null,
    confirm: (message: string, defaultValue?: boolean) => Promise<boolean>,
): Promise<boolean> {
    if (!discordBinary) return false;
    if (options.restart === false) return false;
    if (options.restart === true) return true;
    if (restartMode === "always") return true;
    if (restartMode === "ask") {
        return confirm("Restart Discord now?", true);
    }
    return false;
}

export function registerInjectCommand(program: Command): void {
    program
        .command("inject")
        .description("Patch Discord to load Vencord (native, no external installer)")
        .option("-b, --branch <branch>", "Discord branch: stable (default), canary, ptb")
        .option("--restart", "Restart Discord after patching")
        .option("--no-restart", "Skip Discord restart after patching")
        .action(async (cmdOptions: InjectCmdOptions) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const { renderer } = ctx;
            const configPath = globalOpts.config ?? getConfigPath();
            const config = await loadConfig(ctx.fs, configPath);

            const target = await resolveTarget(ctx.fs, cmdOptions.branch);
            if ("error" in target) {
                renderer.error(makeError(target.error, target.message));
                renderer.finish(false);
                process.exitCode = exitCodeForError(target.error);
                return;
            }

            const discordBinary = config.discord.binary ?? await detectDiscordBinary(ctx.fs);
            const shouldRestart = await shouldRestartAfterInject(
                cmdOptions,
                config.discord.restart,
                discordBinary,
                ctx.prompter.confirm,
            );
            const p = renderer.progress("inject", `Injecting Vencord into ${target.branch} (${target.appPath})...`);

            try {
                const result = await injectVencord(ctx.fs, target);
                p.succeed(`Patched ${result.branch} — shim at ${result.shimAsar}`);
                renderer.text(`Original asar backed up to ${result.backupPath}`);

                let restarted = false;
                if (shouldRestart && discordBinary) {
                    const restartProgress = renderer.progress("restart", "Restarting Discord...");
                    try {
                        await restartDiscord(ctx.fs, ctx.shell, discordBinary);
                        restartProgress.succeed("Discord restarted");
                        restarted = true;
                    } catch (err) {
                        restartProgress.fail("Discord restart failed");
                        renderer.warn(`Patch is installed, but Discord restart failed: ${(err as Error).message}`);
                        renderer.text("Restart Discord manually for changes to take effect.");
                    }
                } else {
                    renderer.text("Restart Discord for changes to take effect.");
                }

                renderer.finish(true, {
                    branch: result.branch,
                    appPath: result.appPath,
                    shimAsar: result.shimAsar,
                    backupPath: result.backupPath,
                    restarted,
                });
            } catch (err) {
                p.fail("Inject failed");
                if (err instanceof InjectError) {
                    const mapped = mapInjectErrorCode(err.code);
                    renderer.error(makeError(mapped, err.message, {
                        suggestion: appManagementSuggestionForInjectError(err),
                    }));
                    renderer.finish(false);
                    process.exitCode = exitCodeForError(mapped);
                    return;
                }
                renderer.error(makeError(ErrorCode.INJECT_FAILED, (err as Error).message, {
                    suggestion: appManagementSuggestionForInjectError(err as Error),
                }));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.INJECT_FAILED);
            }
        });
}

export function registerUninjectCommand(program: Command): void {
    program
        .command("uninject")
        .description("Remove the Vencord patch from Discord")
        .option("-b, --branch <branch>", "Discord branch: stable (default), canary, ptb")
        .action(async (cmdOptions: InjectCmdOptions) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const { renderer } = ctx;

            const target = await resolveTarget(ctx.fs, cmdOptions.branch);
            if ("error" in target) {
                renderer.error(makeError(target.error, target.message));
                renderer.finish(false);
                process.exitCode = exitCodeForError(target.error);
                return;
            }

            const status = await getInjectStatus(ctx.fs, target);
            if (!status.injected) {
                renderer.warn(`Discord ${target.branch} is not injected — nothing to do`);
                renderer.finish(true, { branch: target.branch, injected: false });
                return;
            }

            const p = renderer.progress("uninject", `Removing Vencord patch from ${target.branch}...`);

            try {
                const result = await uninjectVencord(ctx.fs, target);
                p.succeed(`Un-patched ${result.branch}`);
                renderer.finish(true, {
                    branch: result.branch,
                    appPath: result.appPath,
                });
            } catch (err) {
                p.fail("Uninject failed");
                if (err instanceof InjectError) {
                    const mapped = mapInjectErrorCode(err.code);
                    renderer.error(makeError(mapped, err.message, {
                        suggestion: appManagementSuggestionForInjectError(err),
                    }));
                    renderer.finish(false);
                    process.exitCode = exitCodeForError(mapped);
                    return;
                }
                renderer.error(makeError(ErrorCode.INJECT_FAILED, (err as Error).message, {
                    suggestion: appManagementSuggestionForInjectError(err as Error),
                }));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.INJECT_FAILED);
            }
        });
}
