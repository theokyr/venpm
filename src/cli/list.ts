import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadLockfile } from "../core/lockfile.js";
import { getLockfilePath } from "../core/paths.js";
import { jsonSuccess, writeJson } from "../core/json.js";
import { createRealIOContext } from "./context.js";

export async function executeList(ctx: IOContext, options: GlobalOptions = {}): Promise<void> {
    const lockfile = await loadLockfile(ctx.fs, getLockfilePath());
    const installed = Object.entries(lockfile.installed);

    if (options.json) {
        writeJson(jsonSuccess({
            plugins: installed.map(([name, info]) => ({
                name,
                version: info.version,
                repo: info.repo,
                method: info.method,
                pinned: info.pinned,
            })),
        }));
        return;
    }

    if (installed.length === 0) {
        ctx.logger.info("No plugins installed");
        return;
    }
    ctx.logger.info(`Installed plugins (${installed.length}):\n`);
    for (const [name, info] of installed) {
        const pin = info.pinned ? " (pinned)" : "";
        const method = info.method === "local" ? " [local]" : "";
        ctx.logger.info(`  ${name}@${info.version}${pin}${method} — from ${info.repo}`);
    }
}

export function registerListCommand(program: Command): void {
    program
        .command("list")
        .description("List installed plugins")
        .action(async () => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            await executeList(ctx, globalOpts);
        });
}
