import { join, dirname, basename } from "node:path";
import type { Command } from "commander";
import type { FileSystem, IOContext, GlobalOptions } from "../core/types.js";
import { createRealIOContext } from "./context.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateOptions extends GlobalOptions {
    tsx?: boolean;
    css?: boolean;
    native?: boolean;
}

// ─── Mode Detection ───────────────────────────────────────────────────────────

/**
 * Walk up ancestor directories from targetPath looking for a plugins.json whose
 * $schema contains "venpm". Returns "plugin" if found, "repo" otherwise.
 */
export async function detectCreateMode(
    fs: FileSystem,
    targetPath: string,
): Promise<"repo" | "plugin"> {
    let dir = targetPath;
    while (true) {
        const candidate = join(dir, "plugins.json");
        if (await fs.exists(candidate)) {
            try {
                const raw = await fs.readFile(candidate, "utf8");
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                if (typeof parsed.$schema === "string" && parsed.$schema.includes("venpm")) {
                    return "plugin";
                }
            } catch {
                // ignore parse errors — keep walking up
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }
    return "repo";
}

// ─── Scaffold helpers ─────────────────────────────────────────────────────────

const PLUGINS_JSON_SCHEMA = "https://venpm.dev/schemas/v1/plugins.json";

async function scaffoldRepo(ctx: IOContext, targetPath: string): Promise<void> {
    const name = basename(targetPath).replace(/[^a-zA-Z0-9_-]/g, "-");

    // Create directory structure
    await ctx.fs.mkdir(targetPath, { recursive: true });
    await ctx.fs.mkdir(join(targetPath, "plugins"), { recursive: true });
    await ctx.fs.mkdir(join(targetPath, ".github", "workflows"), { recursive: true });

    // plugins.json
    const pluginsJson = {
        $schema: PLUGINS_JSON_SCHEMA,
        name,
        description: `${name} plugin repository`,
        plugins: {},
    };
    await ctx.fs.writeFile(
        join(targetPath, "plugins.json"),
        JSON.stringify(pluginsJson, null, 2) + "\n",
    );
    ctx.logger.success(`Created plugins.json`);

    // .github/workflows/publish.yml
    const publishYml = [
        "name: Publish",
        "",
        "on:",
        "  push:",
        "    branches: [main, master]",
        "  workflow_dispatch:",
        "",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: '20'",
        "      - name: Validate plugins.json",
        "        run: npx venpm validate plugins.json",
        "",
    ].join("\n");
    await ctx.fs.writeFile(join(targetPath, ".github", "workflows", "publish.yml"), publishYml);
    ctx.logger.success(`Created .github/workflows/publish.yml`);

    // README.md
    const readme = [
        `# ${name}`,
        "",
        "A venpm plugin repository.",
        "",
        "## Install",
        "",
        "```bash",
        `venpm repo add ${name} <url-to-your-plugins.json>`,
        "venpm install <PluginName>",
        "```",
        "",
        "## Adding plugins",
        "",
        "```bash",
        "venpm create plugins/<PluginName>",
        "```",
        "",
    ].join("\n");
    await ctx.fs.writeFile(join(targetPath, "README.md"), readme);
    ctx.logger.success(`Created README.md`);

    ctx.logger.info(`Repo scaffold complete at ${targetPath}`);
}

async function scaffoldPlugin(
    ctx: IOContext,
    targetPath: string,
    options: CreateOptions,
    ancestorPluginsJson: string,
): Promise<void> {
    const pluginName = basename(targetPath);
    const ext = options.tsx ? "tsx" : "ts";

    await ctx.fs.mkdir(targetPath, { recursive: true });

    // index.ts / index.tsx
    const indexContent = options.tsx
        ? [
            `import definePlugin from "@utils/types";`,
            ``,
            `export default definePlugin({`,
            `    name: "${pluginName}",`,
            `    description: "TODO: describe ${pluginName}",`,
            `    authors: [{ name: "kamaras", id: "0" }],`,
            ``,
            `    start() {},`,
            `    stop() {},`,
            `});`,
            ``,
        ].join("\n")
        : [
            `import definePlugin from "@utils/types";`,
            ``,
            `export default definePlugin({`,
            `    name: "${pluginName}",`,
            `    description: "TODO: describe ${pluginName}",`,
            `    authors: [{ name: "kamaras", id: "0" }],`,
            ``,
            `    start() {},`,
            `    stop() {},`,
            `});`,
            ``,
        ].join("\n");

    await ctx.fs.writeFile(join(targetPath, `index.${ext}`), indexContent);
    ctx.logger.success(`Created index.${ext}`);

    // Optional style.css
    if (options.css) {
        await ctx.fs.writeFile(
            join(targetPath, "style.css"),
            `/* ${pluginName} styles */\n`,
        );
        ctx.logger.success(`Created style.css`);
    }

    // Optional native.ts
    if (options.native) {
        const nativeContent = [
            `// native.ts — runs in Node.js (Electron main process)`,
            `// Use this for fs, child_process, and other Node.js-only APIs.`,
            ``,
        ].join("\n");
        await ctx.fs.writeFile(join(targetPath, "native.ts"), nativeContent);
        ctx.logger.success(`Created native.ts`);
    }

    // Update ancestor plugins.json
    try {
        const raw = await ctx.fs.readFile(ancestorPluginsJson, "utf8");
        const index = JSON.parse(raw) as {
            $schema?: string;
            name: string;
            description?: string;
            plugins: Record<string, unknown>;
        };

        if (!index.plugins[pluginName]) {
            index.plugins[pluginName] = {
                version: "0.1.0",
                description: `TODO: describe ${pluginName}`,
                authors: [{ name: "kamaras", id: "0" }],
                source: { local: `./${pluginName}` },
            };
            await ctx.fs.writeFile(
                ancestorPluginsJson,
                JSON.stringify(index, null, 2) + "\n",
            );
            ctx.logger.success(`Added "${pluginName}" entry to plugins.json`);
        } else {
            ctx.logger.warn(`"${pluginName}" already exists in plugins.json — skipping entry update`);
        }
    } catch (err) {
        ctx.logger.warn(`Could not update plugins.json: ${err}`);
    }

    ctx.logger.info(`Plugin scaffold complete at ${targetPath}`);
}

// ─── Find ancestor plugins.json ───────────────────────────────────────────────

async function findAncestorPluginsJson(
    fs: FileSystem,
    targetPath: string,
): Promise<string | null> {
    let dir = targetPath;
    while (true) {
        const candidate = join(dir, "plugins.json");
        if (await fs.exists(candidate)) {
            try {
                const raw = await fs.readFile(candidate, "utf8");
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                if (typeof parsed.$schema === "string" && parsed.$schema.includes("venpm")) {
                    return candidate;
                }
            } catch {
                // ignore
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

// ─── Main execute ─────────────────────────────────────────────────────────────

export async function executeCreate(
    ctx: IOContext,
    targetPath: string,
    options: CreateOptions,
): Promise<void> {
    const mode = await detectCreateMode(ctx.fs, targetPath);

    if (mode === "repo") {
        await scaffoldRepo(ctx, targetPath);
    } else {
        const ancestorPluginsJson = await findAncestorPluginsJson(ctx.fs, targetPath);
        if (!ancestorPluginsJson) {
            ctx.logger.error("Could not locate ancestor plugins.json");
            process.exitCode = 1;
            return;
        }
        await scaffoldPlugin(ctx, targetPath, options, ancestorPluginsJson);
    }
}

// ─── CLI Registration ─────────────────────────────────────────────────────────

export function registerCreateCommand(program: Command): void {
    program
        .command("create <path>")
        .description("Scaffold a new plugin repo or plugin")
        .option("--tsx", "Use .tsx instead of .ts")
        .option("--css", "Add style.css")
        .option("--native", "Add native.ts")
        .action(async (targetPath: string, cmdOptions: { tsx?: boolean; css?: boolean; native?: boolean }) => {
            const globalOptions: GlobalOptions = {
                config: program.opts<{ config?: string }>().config,
                verbose: program.opts<{ verbose?: boolean }>().verbose,
            };
            const ctx = createRealIOContext({
                ...globalOptions,
                yes: program.opts<{ yes?: boolean }>().yes,
            });
            const createOptions: CreateOptions = { ...globalOptions, ...cmdOptions };
            await executeCreate(ctx, targetPath, createOptions);
        });
}
