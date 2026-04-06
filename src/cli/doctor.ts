import type { Command } from "commander";

export function registerDoctorCommand(program: Command): void {
    program
        .command("doctor")
        .description("Check venpm environment and configuration")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
