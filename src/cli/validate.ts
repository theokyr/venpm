import type { Command } from "commander";

export function registerValidateCommand(program: Command): void {
    program
        .command("validate <file>")
        .description("Validate a plugin index JSON file")
        .option("--strict", "Enable strict validation mode")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
