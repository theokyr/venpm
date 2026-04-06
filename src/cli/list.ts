import type { Command } from "commander";
import type { IOContext } from "../core/types.js";
import { loadLockfile } from "../core/lockfile.js";
import { getLockfilePath } from "../core/paths.js";
import { createRealIOContext } from "./context.js";

export async function executeList(ctx: IOContext): Promise<void> {
    const lockfile = await loadLockfile(ctx.fs, getLockfilePath());
    const installed = Object.entries(lockfile.installed);
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
            const ctx = createRealIOContext(program.opts());
            await executeList(ctx);
        });
}
