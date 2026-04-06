// ─── Plugin Index (plugins.json) ─────────────────────────────────────────────

export interface PluginAuthor {
    name: string;
    id: string;
}

/** Source location for a plugin — at least one of git/tarball must be present. */
export interface PluginSource {
    /** Git repository URL */
    git?: string;
    /** Path within the git repo to the plugin folder */
    path?: string;
    /** Direct tarball download URL */
    tarball?: string;
    /** Local filesystem path (for development / local repos) */
    local?: string;
}

export interface VersionEntry {
    git_tag?: string;
    tarball?: string;
    sha256?: string;
}

export interface PluginEntry {
    version: string;
    description: string;
    authors: PluginAuthor[];
    license?: string;
    dependencies?: string[];
    /** Semver range for required Discord build */
    discord?: string;
    /** Semver range for required Vencord version */
    vencord?: string;
    source: PluginSource;
    /** Named version history (version string → VersionEntry) */
    versions?: Record<string, VersionEntry>;
}

export interface PluginIndex {
    name: string;
    description?: string;
    /** Plugin name → PluginEntry */
    plugins: Record<string, PluginEntry>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

/** How venpm handles rebuilding Vencord after install/remove */
export type RebuildMode = "ask" | "always" | "never";

/** How venpm handles restarting Discord */
export type RestartMode = "ask" | "always" | "never";

export interface RepoEntry {
    name: string;
    url: string;
}

export interface Config {
    repos: RepoEntry[];
    vencord: {
        /** Absolute path to the Vencord source checkout */
        path: string;
    };
    rebuild: RebuildMode;
    discord: {
        restart: RestartMode;
        /** Path to the Discord binary, or null to auto-detect */
        binary: string | null;
    };
}

// ─── Lockfile ────────────────────────────────────────────────────────────────

export type FetchMethod = "git" | "tarball" | "local";

export interface InstalledPlugin {
    version: string;
    repo: string;
    method: FetchMethod;
    pinned: boolean;
    /** Git commit hash (when method === "git") */
    git_ref?: string;
    installed_at: string;
    /** Override path relative to userplugins dir */
    path?: string;
}

export interface LockfileData {
    /** Plugin name → InstalledPlugin */
    plugins: Record<string, InstalledPlugin>;
    /** ISO timestamp of last full sync */
    last_updated?: string;
}

// ─── Install Plan ────────────────────────────────────────────────────────────

export interface InstallPlanEntry {
    name: string;
    version: string;
    repo: string;
    source: PluginSource;
    method: FetchMethod;
    /** True if this entry was added to satisfy a dependency */
    isDependency: boolean;
    /** Current installed version, if upgrading */
    currentVersion?: string;
}

export interface InstallPlan {
    entries: InstallPlanEntry[];
}

// ─── I/O Context (dependency injection) ─────────────────────────────────────

export interface FileSystem {
    readFile(path: string, encoding: BufferEncoding): Promise<string>;
    writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    symlink(target: string, path: string): Promise<void>;
    readlink(path: string): Promise<string>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>;
    lstat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
    copyDir(src: string, dest: string): Promise<void>;
}

export interface HttpClient {
    fetch(url: string, options?: { headers?: Record<string, string> }): Promise<{
        ok: boolean;
        status: number;
        text(): Promise<string>;
        json(): Promise<unknown>;
        arrayBuffer(): Promise<ArrayBuffer>;
    }>;
}

export interface GitClient {
    available(): Promise<boolean>;
    clone(url: string, dest: string, options?: { sparse?: string[]; branch?: string; depth?: number }): Promise<void>;
    pull(repoPath: string): Promise<void>;
    revParse(repoPath: string, ref: string): Promise<string>;
    checkout(repoPath: string, ref: string): Promise<void>;
}

export interface ShellRunner {
    exec(cmd: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    spawn(cmd: string, args: string[], options?: { cwd?: string; detached?: boolean; env?: Record<string, string> }): Promise<void>;
}

export interface Prompter {
    confirm(message: string, defaultValue?: boolean): Promise<boolean>;
    input(message: string, defaultValue?: string): Promise<string>;
    select<T extends string>(message: string, choices: { value: T; label: string }[]): Promise<T>;
}

export interface Logger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    verbose(message: string, ...args: unknown[]): void;
    success(message: string, ...args: unknown[]): void;
}

export interface IOContext {
    fs: FileSystem;
    http: HttpClient;
    git: GitClient;
    shell: ShellRunner;
    prompter: Prompter;
    logger: Logger;
}

// ─── CLI Options ─────────────────────────────────────────────────────────────

export interface GlobalOptions {
    config?: string;
    verbose?: boolean;
    noColor?: boolean;
}

export interface InstallOptions extends GlobalOptions {
    version?: string;
    pin?: boolean;
    noDeps?: boolean;
    rebuild?: RebuildMode;
    dryRun?: boolean;
}

export interface CreateOptions extends GlobalOptions {
    output?: string;
    force?: boolean;
}

export interface ValidateOptions extends GlobalOptions {
    strict?: boolean;
}
