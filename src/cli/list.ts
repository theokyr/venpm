import type { Command } from "commander";

export function registerListCommand(program: Command): void {
    program
        .command("list")
        .description("List installed plugins")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
