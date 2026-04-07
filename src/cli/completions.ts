import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { createRealIOContext } from "./context.js";

const BASH_COMPLETION = `_venpm_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local commands="install uninstall update list search info repo config create rebuild doctor validate completions"
    if [ "\${COMP_CWORD}" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
}
complete -F _venpm_completions venpm`;

const ZSH_COMPLETION = `#compdef venpm
_venpm() {
    local -a commands
    commands=(
        'install:Install a plugin and its dependencies'
        'uninstall:Remove a plugin'
        'update:Update one or all plugins'
        'list:List installed plugins'
        'search:Search available plugins'
        'info:Show plugin details'
        'repo:Manage plugin repositories'
        'config:View or edit configuration'
        'create:Scaffold a new plugin or repo'
        'rebuild:Rebuild Vencord'
        'doctor:Check environment health'
        'validate:Validate a plugin index'
        'completions:Output shell completion script'
    )
    _describe 'command' commands
}
_venpm`;

const FISH_COMPLETION = `complete -c venpm -n "__fish_use_subcommand" -a install -d "Install a plugin"
complete -c venpm -n "__fish_use_subcommand" -a uninstall -d "Remove a plugin"
complete -c venpm -n "__fish_use_subcommand" -a update -d "Update plugins"
complete -c venpm -n "__fish_use_subcommand" -a list -d "List installed plugins"
complete -c venpm -n "__fish_use_subcommand" -a search -d "Search plugins"
complete -c venpm -n "__fish_use_subcommand" -a info -d "Show plugin details"
complete -c venpm -n "__fish_use_subcommand" -a repo -d "Manage repositories"
complete -c venpm -n "__fish_use_subcommand" -a config -d "View/edit configuration"
complete -c venpm -n "__fish_use_subcommand" -a create -d "Scaffold plugin or repo"
complete -c venpm -n "__fish_use_subcommand" -a rebuild -d "Rebuild Vencord"
complete -c venpm -n "__fish_use_subcommand" -a doctor -d "Check environment"
complete -c venpm -n "__fish_use_subcommand" -a validate -d "Validate plugin index"
complete -c venpm -n "__fish_use_subcommand" -a completions -d "Output completion script"`;

function detectShell(): string {
    const shell = process.env.SHELL ?? "";
    if (shell.includes("zsh")) return "zsh";
    if (shell.includes("fish")) return "fish";
    return "bash";
}

export function registerCompletionsCommand(program: Command): void {
    program
        .command("completions [shell]")
        .description("Output shell completion script (bash, zsh, fish)")
        .action((shell?: string) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);

            const target = shell ?? detectShell();
            switch (target) {
                case "bash":
                    ctx.renderer.write(BASH_COMPLETION + "\n");
                    break;
                case "zsh":
                    ctx.renderer.write(ZSH_COMPLETION + "\n");
                    break;
                case "fish":
                    ctx.renderer.write(FISH_COMPLETION + "\n");
                    break;
                default:
                    ctx.renderer.text(`Unknown shell: ${target}. Supported: bash, zsh, fish`);
                    ctx.renderer.text(`Usage: eval "$(venpm completions zsh)"`);
                    process.exitCode = 1;
            }
        });
}
