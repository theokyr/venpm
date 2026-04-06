import type { Command } from "commander";

export function registerUpdateCommand(program: Command): void {
    program
        .command("update [plugin]")
        .description("Update a plugin or all plugins")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
