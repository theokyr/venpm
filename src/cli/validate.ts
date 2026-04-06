import type { Command } from "commander";
import { join } from "node:path";
import { validateIndex } from "../core/schema.js";
import { createRealIOContext } from "./context.js";
import type { PluginIndex, PluginEntry } from "../core/types.js";

export function registerValidateCommand(program: Command): void {
    program
        .command("validate [path]")
        .description("Validate a plugin index JSON file")
        .option("--strict", "Also check dependency references and tarball URLs")
        .action(async (filePath: string | undefined, options: { strict?: boolean }) => {
            const ctx = createRealIOContext(program.opts());
            const targetPath = filePath ?? join(process.cwd(), "plugins.json");

            let raw: string;
            try {
                raw = await ctx.fs.readFile(targetPath, "utf-8");
            } catch {
                ctx.logger.error(`Cannot read file: ${targetPath}`);
                process.exit(1);
            }

            let data: unknown;
            try {
                data = JSON.parse(raw);
            } catch (err) {
                ctx.logger.error(`Invalid JSON: ${(err as Error).message}`);
                process.exit(1);
            }

            const result = validateIndex(data);

            if (!result.valid) {
                ctx.logger.error(`Validation failed (${result.errors.length} error(s)):`);
                for (const e of result.errors) {
                    ctx.logger.error(`  ${e}`);
                }
                process.exit(1);
            }

            if (options.strict) {
                const index = data as PluginIndex;
                const plugins = index.plugins ?? {};
                const pluginNames = new Set(Object.keys(plugins));
                const strictErrors: string[] = [];

                for (const [name, entry] of Object.entries(plugins) as [string, PluginEntry][]) {
                    // Check dependency references
                    if (entry.dependencies) {
                        for (const dep of entry.dependencies) {
                            if (!pluginNames.has(dep)) {
                                strictErrors.push(`${name}: dependency "${dep}" is not in the index`);
                            }
                        }
                    }

                    // Check HEAD tarball URLs in versions
                    if (entry.versions) {
                        for (const [ver, vEntry] of Object.entries(entry.versions)) {
                            const tarball = vEntry.tarball;
                            if (tarball) {
                                try {
                                    const res = await ctx.http.fetch(tarball, {});
                                    if (!res.ok) {
                                        strictErrors.push(`${name}@${ver}: tarball URL returned ${res.status}: ${tarball}`);
                                    }
                                } catch (err) {
                                    strictErrors.push(`${name}@${ver}: tarball URL unreachable: ${tarball} (${(err as Error).message})`);
                                }
                            }
                        }
                    }

                    // Check top-level tarball
                    if (entry.source?.tarball) {
                        try {
                            const res = await ctx.http.fetch(entry.source.tarball, {});
                            if (!res.ok) {
                                strictErrors.push(`${name}: source tarball returned ${res.status}: ${entry.source.tarball}`);
                            }
                        } catch (err) {
                            strictErrors.push(`${name}: source tarball unreachable: ${entry.source.tarball} (${(err as Error).message})`);
                        }
                    }
                }

                if (strictErrors.length > 0) {
                    ctx.logger.error(`Strict validation failed (${strictErrors.length} issue(s)):`);
                    for (const e of strictErrors) {
                        ctx.logger.error(`  ${e}`);
                    }
                    process.exit(1);
                }
            }

            ctx.logger.success(`${targetPath} is valid`);
        });
}
