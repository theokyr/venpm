import type { Command } from "commander";
import { join } from "node:path";
import type { GlobalOptions, PluginIndex, PluginEntry } from "../core/types.js";
import { validateIndex } from "../core/schema.js";
import { ErrorCode, makeError, exitCodeForError } from "../core/errors.js";
import { createRealIOContext } from "./context.js";

export function registerValidateCommand(program: Command): void {
    program
        .command("validate [path]")
        .description("Validate a plugin index JSON file")
        .option("--strict", "Also check dependency references and tarball URLs")
        .action(async (filePath: string | undefined, options: { strict?: boolean }) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const { renderer } = ctx;
            const targetPath = filePath ?? join(process.cwd(), "plugins.json");

            let raw: string;
            try {
                raw = await ctx.fs.readFile(targetPath, "utf-8");
            } catch {
                renderer.error(makeError(ErrorCode.SCHEMA_INVALID, `Cannot read file: ${targetPath}`));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.SCHEMA_INVALID);
                return;
            }

            let data: unknown;
            try {
                data = JSON.parse(raw);
            } catch (err) {
                renderer.error(makeError(ErrorCode.SCHEMA_INVALID, `Invalid JSON: ${(err as Error).message}`));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.SCHEMA_INVALID);
                return;
            }

            const result = validateIndex(data);
            const allErrors = [...result.errors];

            if (result.valid && options.strict) {
                const index = data as PluginIndex;
                const plugins = index.plugins ?? {};
                const pluginNames = new Set(Object.keys(plugins));

                for (const [name, entry] of Object.entries(plugins) as [string, PluginEntry][]) {
                    if (entry.dependencies) {
                        for (const dep of entry.dependencies) {
                            if (!pluginNames.has(dep)) {
                                allErrors.push(`${name}: dependency "${dep}" is not in the index`);
                            }
                        }
                    }

                    if (entry.versions) {
                        for (const [ver, vEntry] of Object.entries(entry.versions)) {
                            const tarball = vEntry.tarball;
                            if (tarball) {
                                try {
                                    const res = await ctx.http.fetch(tarball, {});
                                    if (!res.ok) {
                                        allErrors.push(`${name}@${ver}: tarball URL returned ${res.status}: ${tarball}`);
                                    }
                                } catch (err) {
                                    allErrors.push(`${name}@${ver}: tarball URL unreachable: ${tarball} (${(err as Error).message})`);
                                }
                            }
                        }
                    }

                    if (entry.source?.tarball) {
                        try {
                            const res = await ctx.http.fetch(entry.source.tarball, {});
                            if (!res.ok) {
                                allErrors.push(`${name}: source tarball returned ${res.status}: ${entry.source.tarball}`);
                            }
                        } catch (err) {
                            allErrors.push(`${name}: source tarball unreachable: ${entry.source.tarball} (${(err as Error).message})`);
                        }
                    }
                }
            }

            const valid = result.valid && allErrors.length === 0;

            if (!valid) {
                renderer.error(makeError(ErrorCode.SCHEMA_INVALID, `Validation failed (${allErrors.length} error(s))`));
                for (const e of allErrors) {
                    renderer.text(`  ${e}`);
                }
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.SCHEMA_INVALID);
                return;
            }

            renderer.success(`${targetPath} is valid`);
            renderer.finish(true, { path: targetPath, valid: true, errors: [] });
        });
}
