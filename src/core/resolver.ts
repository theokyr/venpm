import type {
    FetchMethod,
    InstallPlan,
    InstallPlanEntry,
    LockfileData,
    PluginEntry,
    PluginIndex,
} from "./types.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ResolverError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResolverError";
    }
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface ResolveOptions {
    gitAvailable: boolean;
    forceMethod?: FetchMethod;
    version?: string;
    fromRepo?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find a plugin by name across all indexes, optionally filtered by repo name.
 * Returns the first match found. If `fromRepo` is given, only that repo is searched.
 */
export function findPlugin(
    indexes: PluginIndex[],
    name: string,
    fromRepo?: string,
): { repoName: string; entry: PluginEntry } | null {
    for (const index of indexes) {
        if (fromRepo !== undefined && index.name !== fromRepo) continue;
        if (Object.prototype.hasOwnProperty.call(index.plugins, name)) {
            return { repoName: index.name, entry: index.plugins[name] };
        }
    }
    return null;
}

// ─── Version Resolution ───────────────────────────────────────────────────────

/**
 * Resolve a version string for a plugin entry.
 *
 * - No constraint → return the entry's latest `version` field.
 * - Constraint provided → look up in the entry's `versions` map and return it.
 * - Version not found → throw ResolverError.
 */
export function resolveVersion(entry: PluginEntry, constraint?: string): string {
    if (constraint === undefined || constraint === null) {
        return entry.version;
    }
    const versions = entry.versions ?? {};
    if (!Object.prototype.hasOwnProperty.call(versions, constraint)) {
        throw new ResolverError(
            `Version "${constraint}" not found. Available versions: ${Object.keys(versions).join(", ") || "(none)"}`,
        );
    }
    return constraint;
}

// ─── Dependency Graph ─────────────────────────────────────────────────────────

/**
 * Build a topologically-sorted install order for `pluginName` and all its
 * transitive dependencies. Circular dependencies are detected and will throw
 * a ResolverError. Missing dependencies also throw.
 *
 * Returns an array of plugin names in dependency-first order (deps before dependents).
 */
export function buildDependencyGraph(indexes: PluginIndex[], pluginName: string): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function visit(name: string): void {
        if (inStack.has(name)) {
            throw new ResolverError(`Circular dependency detected involving "${name}"`);
        }
        if (visited.has(name)) return;

        inStack.add(name);

        const found = findPlugin(indexes, name);
        if (!found) {
            throw new ResolverError(`Dependency "${name}" not found in any index`);
        }

        const deps = found.entry.dependencies ?? [];
        for (const dep of deps) {
            visit(dep);
        }

        inStack.delete(name);
        visited.add(name);
        order.push(name);
    }

    visit(pluginName);
    return order;
}

// ─── Method Selection ─────────────────────────────────────────────────────────

function selectMethod(
    entry: PluginEntry,
    gitAvailable: boolean,
    forceMethod?: FetchMethod,
): FetchMethod {
    const { source } = entry;

    if (forceMethod !== undefined) {
        // Validate that the forced method is actually available
        if (forceMethod === "git" && source.git) return "git";
        if (forceMethod === "tarball" && source.tarball) return "tarball";
        if (forceMethod === "local" && source.local) return "local";
        throw new ResolverError(
            `Forced method "${forceMethod}" is not available for this plugin (source has: ${Object.keys(source).join(", ")})`,
        );
    }

    // Default selection: git > tarball > local
    if (gitAvailable && source.git) return "git";
    if (source.tarball) return "tarball";
    if (source.local) return "local";

    throw new ResolverError(
        `No suitable fetch method available for plugin (git available: ${gitAvailable}, source: ${JSON.stringify(source)})`,
    );
}

// ─── Install Plan ─────────────────────────────────────────────────────────────

/**
 * Collect optional dependencies that are not currently installed.
 * These are surfaced as warnings, not auto-installed.
 */
export function collectMissingOptionalDeps(
    indexes: PluginIndex[],
    pluginName: string,
    lockfile: LockfileData,
): string[] {
    const found = findPlugin(indexes, pluginName);
    if (!found) return [];

    const optDeps = found.entry.optionalDependencies ?? [];
    return optDeps.filter(dep => !Object.prototype.hasOwnProperty.call(lockfile.installed, dep));
}

/**
 * Generate a full install plan for `pluginName`, resolving dependencies and
 * skipping already-installed plugins. Returns an InstallPlan with entries in
 * dependency-first order, plus any missing optional deps as warnings.
 */
export function generateInstallPlan(
    indexes: PluginIndex[],
    pluginName: string,
    lockfile: LockfileData,
    options: ResolveOptions,
): InstallPlan {
    const order = buildDependencyGraph(indexes, pluginName);

    const entries: InstallPlanEntry[] = [];

    for (const name of order) {
        const alreadyInstalled = Object.prototype.hasOwnProperty.call(lockfile.installed, name);
        if (alreadyInstalled) continue;

        const found = findPlugin(indexes, name, options.fromRepo);
        // findPlugin without fromRepo will never return null here since buildDependencyGraph
        // already validated all deps, but we fall back to searching all indexes.
        const result = found ?? findPlugin(indexes, name)!;

        const { repoName, entry } = result;

        // For the root plugin, apply the version constraint; deps get their latest.
        const constraint = name === pluginName ? options.version : undefined;
        const version = resolveVersion(entry, constraint);

        const method = selectMethod(entry, options.gitAvailable, options.forceMethod);
        const isDependency = name !== pluginName;

        entries.push({
            name,
            version,
            repo: repoName,
            source: entry.source,
            method,
            isDependency,
            versionEntry: entry.versions?.[version],
        });
    }

    const missingOptional = collectMissingOptionalDeps(indexes, pluginName, lockfile);

    return { entries, missingOptional };
}
