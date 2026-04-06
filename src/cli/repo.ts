import type { Command } from "commander";

export function registerRepoCommand(program: Command): void {
    program
        .command("repo")
        .description("Manage plugin repositories")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
