import type { Command } from "commander";

export function registerCreateCommand(program: Command): void {
    program
        .command("create [name]")
        .description("Scaffold a new plugin index or plugin entry")
        .option("-o, --output <path>", "Output directory")
        .option("-f, --force", "Overwrite existing files")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
