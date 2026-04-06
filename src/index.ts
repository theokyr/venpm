#!/usr/bin/env node
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

const program = new Command();

program
    .name("venpm")
    .description("Vencord Plugin Manager — install and manage userplugins")
    .version("0.1.0")
    .option("-y, --yes", "Automatically answer yes to all prompts")
    .option("--verbose", "Enable verbose output")
    .option("--quiet", "Suppress non-essential output");

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

program.parse();
