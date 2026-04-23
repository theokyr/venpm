import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
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

async function resolveTarget(
    fs: Parameters<typeof detectDiscordApps>[0],
    branch: string | undefined,
): Promise<InjectTarget | { error: ErrorCodeValue; message: string }> {
    const apps = await detectDiscordApps(fs);

    if (apps.length === 0) {
        if (process.platform !== "darwin") {
            return {
                error: ErrorCode.PLATFORM_UNSUPPORTED,
                message: `Native inject is currently macOS-only (detected ${process.platform})`,
            };
        }
        return {
            error: ErrorCode.DISCORD_NOT_FOUND,
            message: "No Discord.app found in /Applications",
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
            message: `Discord ${requested} not found in /Applications`,
        };
    }
    return match;
}

export function registerInjectCommand(program: Command): void {
    program
        .command("inject")
        .description("Patch Discord.app to load Vencord (native, no external installer)")
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

            const p = renderer.progress("inject", `Injecting Vencord into ${target.branch} (${target.appPath})...`);

            try {
                const result = await injectVencord(ctx.fs, target);
                p.succeed(`Patched ${result.branch} — shim at ${result.shimAsar}`);
                renderer.text(`Original asar backed up to ${result.backupPath}`);
                renderer.text("Restart Discord for changes to take effect.");
                renderer.finish(true, {
                    branch: result.branch,
                    appPath: result.appPath,
                    shimAsar: result.shimAsar,
                    backupPath: result.backupPath,
                });
            } catch (err) {
                p.fail("Inject failed");
                if (err instanceof InjectError) {
                    const mapped = mapInjectErrorCode(err.code);
                    renderer.error(makeError(mapped, err.message));
                    renderer.finish(false);
                    process.exitCode = exitCodeForError(mapped);
                    return;
                }
                renderer.error(makeError(ErrorCode.INJECT_FAILED, (err as Error).message));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.INJECT_FAILED);
            }
        });
}

export function registerUninjectCommand(program: Command): void {
    program
        .command("uninject")
        .description("Remove the Vencord patch from Discord.app")
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
                    renderer.error(makeError(mapped, err.message));
                    renderer.finish(false);
                    process.exitCode = exitCodeForError(mapped);
                    return;
                }
                renderer.error(makeError(ErrorCode.INJECT_FAILED, (err as Error).message));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.INJECT_FAILED);
            }
        });
}
