import type { Command } from "commander";

export function registerInstallCommand(program: Command): void {
    program
        .command("install <plugin>")
        .description("Install a plugin")
        .option("-v, --version <version>", "Plugin version to install")
        .option("--pin", "Pin the plugin to this version")
        .option("--no-deps", "Skip dependency resolution")
        .option("--rebuild <mode>", "Rebuild mode: ask, always, never")
        .option("--dry-run", "Preview what would be installed without making changes")
        .action(async () => {
            console.log("Not yet implemented");
        });
}
