import type { Command } from "commander";
import type { IOContext, GlobalOptions } from "../core/types.js";
import { loadLockfile } from "../core/lockfile.js";
import { getLockfilePath } from "../core/paths.js";
import { createRealIOContext } from "./context.js";

export async function executeList(ctx: IOContext, options: GlobalOptions = {}): Promise<void> {
    const { renderer } = ctx;
    const lockfile = await loadLockfile(ctx.fs, getLockfilePath());
    const installed = Object.entries(lockfile.installed);

    if (installed.length === 0) {
        renderer.text("No plugins installed");
        renderer.finish(true, { plugins: [] });
        return;
    }

    renderer.heading(`Installed plugins (${installed.length})`);
    renderer.table(
        ["Name", "Version", "Repo", "Method", "Pinned"],
        installed.map(([name, info]) => [
            name,
            info.version,
            info.repo,
            info.method,
            info.pinned ? "yes" : "no",
        ]),
    );

    renderer.finish(true, {
        plugins: installed.map(([name, info]) => ({
            name,
            version: info.version,
            repo: info.repo,
            method: info.method,
            pinned: info.pinned,
        })),
    });
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
