#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { registerInstallCommand } from "./cli/install.js";
import { registerUninstallCommand } from "./cli/uninstall.js";
import { registerUpdateCommand } from "./cli/update.js";
import { registerListCommand } from "./cli/list.js";
import { registerSearchCommand } from "./cli/search.js";
import { registerInfoCommand } from "./cli/info.js";
import { registerRepoCommand } from "./cli/repo.js";
import { registerConfigCommand } from "./cli/config-cmd.js";
import { registerCreateCommand } from "./cli/create.js";
import { registerRebuildCommand } from "./cli/rebuild.js";
import { registerDoctorCommand } from "./cli/doctor.js";
import { registerValidateCommand } from "./cli/validate.js";
import { configureHelp } from "./cli/help.js";
import { registerCompletionsCommand } from "./cli/completions.js";
import { createRealIOContext } from "./cli/context.js";
import type { GlobalOptions } from "./core/types.js";
import { needsFirstRun, runFirstTimeSetup } from "./cli/first-run.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

const program = new Command();

program
    .name("venpm")
    .description("Vencord Plugin Manager — install and manage userplugins")
    .version(version)
    .option("-y, --yes", "Automatically answer yes to all prompts")
    .option("--verbose", "Enable verbose output")
    .option("--quiet", "Suppress non-essential output")
    .option("--json", "Output structured JSON instead of human-readable text")
    .option("--json-stream", "Output events as NDJSON")
    .option("--no-color", "Disable colored output");

configureHelp(program);

registerInstallCommand(program);
registerUninstallCommand(program);
registerUpdateCommand(program);
registerListCommand(program);
registerSearchCommand(program);
registerInfoCommand(program);
registerRepoCommand(program);
registerConfigCommand(program);
registerCreateCommand(program);
registerRebuildCommand(program);
registerDoctorCommand(program);
registerValidateCommand(program);
registerCompletionsCommand(program);

program.hook("preAction", async (thisCommand) => {
    const commandName = thisCommand.args[0] ?? "";
    if (needsFirstRun(commandName)) {
        const globalOpts = program.opts<GlobalOptions>();
        const ctx = createRealIOContext(globalOpts);
        await runFirstTimeSetup(ctx, version);
    }
});

program.parse();
