import type { Command } from "commander";

export function registerInfoCommand(program: Command): void {
    program
        .command("info <plugin>")
        .description("Show details about a plugin")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
