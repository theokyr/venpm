import type { Command } from "commander";
import { shouldColorize, createColors } from "../core/ansi.js";

export function configureHelp(program: Command): void {
    const colorEnabled = shouldColorize(process.stdout);
    const c = createColors(colorEnabled);

    program.configureHelp({
        formatHelp(cmd, _helper) {
            const lines: string[] = [];

            lines.push(`  ${c.bold("venpm")} ${c.dim("— Vencord Plugin Manager")}`);
            lines.push("");

            lines.push(`  ${c.bright("USAGE")}`);
            lines.push(`    venpm <command> [options]`);
            lines.push("");

            const commands = cmd.commands.filter((sub: Command) => !(sub as any)._hidden);
            if (commands.length > 0) {
                lines.push(`  ${c.bright("COMMANDS")}`);
                const maxLen = Math.max(...commands.map((sub: Command) => {
                    const usage = sub.usage();
                    return sub.name().length + (usage ? usage.length + 1 : 0);
                }));
                for (const sub of commands) {
                    const usage = sub.usage();
                    const name = usage ? `${sub.name()} ${usage}` : sub.name();
                    lines.push(`    ${c.amber(name.padEnd(maxLen + 2))} ${c.dim(sub.description() ?? "")}`);
                }
                lines.push("");
            }

            const opts = cmd.options;
            if (opts.length > 0) {
                lines.push(`  ${c.bright("OPTIONS")}`);
                const maxOptLen = Math.max(...opts.map((o: any) => o.flags.length));
                for (const opt of opts) {
                    lines.push(`    ${(opt as any).flags.padEnd(maxOptLen + 2)} ${c.dim(opt.description)}`);
                }
                lines.push("");
            }

            lines.push(`  ${c.dim("DOCS")}  ${c.amber("https://venpm.dev")}`);
            lines.push("");

            return lines.join("\n");
        },
    });
}
