import { join } from "node:path";
import type { Command } from "commander";
import type { IOContext, GlobalOptions, InstallOptions, RebuildMode } from "../core/types.js";
import { loadConfig } from "../core/config.js";
import { loadLockfile, saveLockfile, addInstalled } from "../core/lockfile.js";
import { fetchAllIndexes, resolvePlugin } from "../core/registry.js";
import { loadCache, saveCache } from "../core/cache.js";
import { generateInstallPlan, ResolverError } from "../core/resolver.js";
import { fetchPlugin, fetchViaLocal } from "../core/fetcher.js";
import { buildAndDeploy } from "../core/builder.js";
import { detectVencordPath, detectDiscordBinary } from "../core/detect.js";
import { getConfigPath, getLockfilePath } from "../core/paths.js";
import { ErrorCode, makeError } from "../core/errors.js";
import { findCandidates } from "../core/fuzzy.js";
import { createRealIOContext } from "./context.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export async function executeInstall(
    ctx: IOContext,
    pluginName: string,
    options: InstallOptions,
): Promise<void> {
    const { fs, http, git, shell, prompter, renderer } = ctx;

    // 1. Load config and lockfile
    const configPath = options.config ?? getConfigPath();
    const lockfilePath = getLockfilePath();

    const config = await loadConfig(fs, configPath);
    let lockfile = await loadLockfile(fs, lockfilePath);

    // 2. Resolve Vencord path
    const vencordPath = config.vencord.path ?? await detectVencordPath(fs);
    if (!vencordPath) {
        renderer.error(makeError(ErrorCode.VENCORD_NOT_FOUND, "Could not find Vencord source path. Set vencord.path in config or VENPM_VENCORD_PATH env var."));
        renderer.finish(false);
        process.exitCode = 1;
        return;
    }

    const userpluginDir = join(vencordPath, "src", "userplugins");

    // 3. Handle --local flag: symlink and update lockfile, then done
    if (options.local) {
        const localPath = options.local;
        const dest = join(userpluginDir, pluginName);
        renderer.text(`Symlinking ${localPath} → ${dest}`);
        await fetchViaLocal(fs, localPath, dest);
        lockfile = addInstalled(lockfile, pluginName, {
            version: "local",
            repo: "local",
            method: "local",
            pinned: false,
            installed_at: new Date().toISOString(),
        });
        await saveLockfile(fs, lockfilePath, lockfile);
        renderer.success(`Installed ${pluginName} from local path`);
        renderer.finish(true, { installed: [{ name: pluginName, version: "local", method: "local" }], warnings: [] });
        return;
    }

    // 4. Fetch all indexes (with cache)
    const p = renderer.progress("fetch-indexes", "Fetching indexes...");
    const cache = await loadCache(fs);
    const { results: fetchedIndexes, updatedCache } = await fetchAllIndexes(http, config.repos, { cache });
    await saveCache(fs, updatedCache);
    const validIndexes = fetchedIndexes.filter(fi => fi.index !== undefined);
    const fetchErrors = fetchedIndexes.filter(fi => fi.error);
    p.succeed(`${validIndexes.length} repo(s) fetched`);

    for (const fi of fetchErrors) {
        renderer.warn(`Failed to fetch index from repo "${fi.repoName}": ${fi.error}`);
    }

    // 5. Resolve plugin
    const match = resolvePlugin(fetchedIndexes, pluginName, options.from);
    if (!match) {
        const allPluginNames = fetchedIndexes.flatMap(fi => Object.keys(fi.index?.plugins ?? {}));
        const candidates = findCandidates(pluginName, allPluginNames);
        const msg = options.from
            ? `Plugin "${pluginName}" not found in repo "${options.from}"`
            : `Plugin "${pluginName}" not found in any configured repo`;
        renderer.error(makeError(ErrorCode.PLUGIN_NOT_FOUND, msg, { candidates }));
        renderer.finish(false);
        process.exitCode = 1;
        return;
    }

    // Check for multiple matches (without --from, warn if plugin appears in multiple repos)
    if (!options.from) {
        const allMatches = fetchedIndexes.filter(fi => fi.index?.plugins[pluginName]);
        if (allMatches.length > 1) {
            renderer.warn(
                `Plugin "${pluginName}" found in multiple repos: ${allMatches.map(fi => fi.repoName).join(", ")}. ` +
                `Using "${match.repoName}". Use --from <repo> to specify.`,
            );
        }
    }

    // 6. Generate install plan
    const gitAvailable = await git.available();

    let forceMethod: "git" | "tarball" | undefined;
    if (options.git) forceMethod = "git";
    else if (options.tarball) forceMethod = "tarball";

    const pluginIndexes = validIndexes
        .map(fi => fi.index!)
        .filter(idx => idx !== undefined);

    let plan;
    try {
        plan = generateInstallPlan(pluginIndexes, pluginName, lockfile, {
            gitAvailable,
            forceMethod,
            version: options.version,
            fromRepo: options.from,
        });
    } catch (err) {
        if (err instanceof ResolverError) {
            renderer.error(makeError(ErrorCode.CIRCULAR_DEPENDENCY, err.message));
            renderer.finish(false);
            process.exitCode = 1;
            return;
        }
        throw err;
    }

    if (plan.entries.length === 0) {
        renderer.text(`Plugin "${pluginName}" is already installed.`);
        renderer.finish(true, { installed: [], warnings: [] });
        return;
    }

    // 7. Show plan and confirm
    renderer.heading("Install plan");
    renderer.table(
        ["Plugin", "Version", "Method", "Type"],
        plan.entries.map(entry => [
            entry.name,
            entry.version,
            entry.method,
            entry.isDependency ? "dependency" : "direct",
        ]),
    );

    // Warn about missing optional dependencies
    const warnings: string[] = [];
    if (plan.missingOptional?.length) {
        const warnMsg = `Recommended plugins not installed: ${plan.missingOptional.join(", ")}`;
        renderer.warn(warnMsg);
        renderer.text(`  Install with: venpm install ${plan.missingOptional.join(" ")}`);
        warnings.push(warnMsg);
    }

    const confirmed = await prompter.confirm(`Proceed with installation?`, true);
    if (!confirmed) {
        renderer.text("Installation cancelled.");
        renderer.finish(false);
        return;
    }

    // 8. Fetch each entry and update lockfile
    const installedEntries: { name: string; version: string; method: string }[] = [];
    for (const entry of plan.entries) {
        const ep = renderer.progress(`install-${entry.name}`, `Installing ${entry.name}@${entry.version} via ${entry.method}...`);
        try {
            const result = await fetchPlugin(entry, userpluginDir, { fs, git, http });

            lockfile = addInstalled(lockfile, entry.name, {
                version: entry.version,
                repo: entry.repo,
                method: result.method,
                pinned: options.version !== undefined,
                git_ref: result.git_ref,
                installed_at: new Date().toISOString(),
                path: result.path,
            });
            installedEntries.push({ name: entry.name, version: entry.version, method: result.method });
            ep.succeed(`${entry.name}@${entry.version}`);
        } catch (err) {
            ep.fail(`${entry.name}: ${err instanceof Error ? err.message : err}`);
            renderer.error(makeError(ErrorCode.BUILD_FAILED, `Failed to install ${entry.name}: ${err instanceof Error ? err.message : err}`));
            renderer.finish(false);
            process.exitCode = 1;
            return;
        }
    }

    // 9. Save lockfile
    await saveLockfile(fs, lockfilePath, lockfile);

    renderer.success(`Successfully installed ${pluginName}`);
    renderer.finish(true, { installed: installedEntries, warnings });

    // 10. Handle rebuild
    const effectiveRebuildMode = resolveRebuildMode(options, config.rebuild);

    if (effectiveRebuildMode === "always" || options.rebuild) {
        if (!options.noBuild) {
            await runRebuild(ctx, vencordPath);
        }
    } else if (effectiveRebuildMode === "ask" && !options.noBuild) {
        const doRebuild = await prompter.confirm("Rebuild Vencord now?", true);
        if (doRebuild) {
            await runRebuild(ctx, vencordPath);
        }
    }
    // "never" or noBuild: skip rebuild silently
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveRebuildMode(options: InstallOptions, configMode: RebuildMode): RebuildMode {
    if (options.noBuild) return "never";
    if (options.rebuild) return "always";
    return configMode;
}

async function runRebuild(ctx: IOContext, vencordPath: string): Promise<void> {
    const { fs, shell, renderer } = ctx;
    const p = renderer.progress("rebuild", "Rebuilding Vencord...");
    const discordBinary = await detectDiscordBinary(fs);
    try {
        const result = await buildAndDeploy(fs, shell, vencordPath, {
            restart: discordBinary !== null,
            discordBinary: discordBinary ?? undefined,
        });
        if (result.deployed) {
            p.succeed(`Deployed to ${result.deployPath}`);
        } else {
            p.succeed("Build complete (deploy path not found, skipped deploy)");
        }
    } catch (err) {
        p.fail(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ─── CLI Registration ─────────────────────────────────────────────────────────

export function registerInstallCommand(program: Command): void {
    program
        .command("install <plugin>")
        .description("Install a plugin and its dependencies")
        .option("--version <semver>", "Install specific version")
        .option("--from <repo>", "Install from a specific repo")
        .option("--local <path>", "Symlink a local directory")
        .option("--git", "Force git clone")
        .option("--tarball", "Force tarball download")
        .option("--no-build", "Skip Vencord rebuild")
        .option("--rebuild", "Force Vencord rebuild")
        .action(async (pluginName: string, opts: Record<string, unknown>) => {
            const globalOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(globalOpts);
            const options: InstallOptions = {
                ...globalOpts,
                version: opts["version"] as string | undefined,
                from: opts["from"] as string | undefined,
                local: opts["local"] as string | undefined,
                git: opts["git"] as boolean | undefined,
                tarball: opts["tarball"] as boolean | undefined,
                noBuild: opts["build"] === false, // commander uses --no-build → build=false
                rebuild: opts["rebuild"] as boolean | undefined,
            };
            await executeInstall(ctx, pluginName, options);
        });
}
