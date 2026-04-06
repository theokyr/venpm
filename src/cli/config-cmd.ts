import type { Command } from "commander";

export function registerConfigCommand(program: Command): void {
    program
        .command("config")
        .description("View or edit venpm configuration")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
