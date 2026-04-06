import type { Command } from "commander";

export function registerUninstallCommand(program: Command): void {
    program
        .command("uninstall <plugin>")
        .description("Uninstall a plugin")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
