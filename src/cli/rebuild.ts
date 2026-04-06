import type { Command } from "commander";

export function registerRebuildCommand(program: Command): void {
    program
        .command("rebuild")
        .description("Rebuild Vencord after plugin changes")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
