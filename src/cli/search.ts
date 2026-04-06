import type { Command } from "commander";

export function registerSearchCommand(program: Command): void {
    program
        .command("search <query>")
        .description("Search for plugins in configured repositories")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
