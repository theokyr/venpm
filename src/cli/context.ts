import { execFile as _execFile, spawn as _spawn } from "node:child_process";
import { promisify } from "node:util";
import * as fsPromises from "node:fs/promises";
import { createPrompter } from "../core/prompt.js";
import { createLogger } from "../core/log.js";
import type { IOContext, FileSystem, HttpClient, GitClient, ShellRunner, GlobalOptions } from "../core/types.js";

const execFileAsync = promisify(_execFile);

export function createRealIOContext(options: GlobalOptions & { yes?: boolean; quiet?: boolean }): IOContext {
    const fs: FileSystem = {
        async readFile(path: string, encoding: BufferEncoding): Promise<string> {
            return fsPromises.readFile(path, { encoding });
        },

        async writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void> {
            return fsPromises.writeFile(path, data, { encoding: encoding ?? "utf8" });
        },

        async exists(path: string): Promise<boolean> {
            try {
                await fsPromises.access(path);
                return true;
            } catch {
                return false;
            }
        },

        async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
            await fsPromises.mkdir(path, opts);
        },

        async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
            await fsPromises.rm(path, opts);
        },

        async symlink(target: string, path: string): Promise<void> {
            return fsPromises.symlink(target, path);
        },

        async readlink(path: string): Promise<string> {
            return fsPromises.readlink(path);
        },

        async readdir(path: string): Promise<string[]> {
            return fsPromises.readdir(path);
        },

        async stat(path: string) {
            return fsPromises.stat(path);
        },

        async lstat(path: string) {
            return fsPromises.lstat(path);
        },

        async copyDir(src: string, dest: string): Promise<void> {
            await fsPromises.cp(src, dest, { recursive: true });
        },
    };

    const http: HttpClient = {
        async fetch(url: string, fetchOptions?: { headers?: Record<string, string> }) {
            const res = await globalThis.fetch(url, { headers: fetchOptions?.headers });
            return {
                ok: res.ok,
                status: res.status,
                headers: res.headers,
                text: () => res.text(),
                json: () => res.json() as Promise<unknown>,
                arrayBuffer: () => res.arrayBuffer(),
            };
        },
    };

    const git: GitClient = {
        async available(): Promise<boolean> {
            try {
                await execFileAsync("git", ["--version"]);
                return true;
            } catch {
                return false;
            }
        },

        async clone(url: string, dest: string, cloneOptions?: { sparse?: string[]; branch?: string; depth?: number }): Promise<void> {
            const args = ["clone", "--filter=blob:none"];
            if (cloneOptions?.sparse && cloneOptions.sparse.length > 0) {
                args.push("--sparse");
            }
            if (cloneOptions?.branch) {
                args.push("--branch", cloneOptions.branch);
            }
            if (cloneOptions?.depth !== undefined) {
                args.push("--depth", String(cloneOptions.depth));
            }
            args.push(url, dest);
            await execFileAsync("git", args);

            if (cloneOptions?.sparse && cloneOptions.sparse.length > 0) {
                await execFileAsync("git", ["-C", dest, "sparse-checkout", "set", ...cloneOptions.sparse]);
            }
        },

        async pull(repoPath: string): Promise<void> {
            await execFileAsync("git", ["-C", repoPath, "pull"]);
        },

        async revParse(repoPath: string, ref: string): Promise<string> {
            const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", ref]);
            return stdout.trim();
        },

        async checkout(repoPath: string, ref: string): Promise<void> {
            await execFileAsync("git", ["-C", repoPath, "checkout", ref]);
        },
    };

    const shell: ShellRunner = {
        async exec(cmd: string, args: string[], execOptions?: { cwd?: string; env?: Record<string, string> }) {
            try {
                const { stdout, stderr } = await execFileAsync(cmd, args, {
                    cwd: execOptions?.cwd,
                    env: execOptions?.env ? { ...process.env, ...execOptions.env } : undefined,
                });
                return { stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 };
            } catch (err: unknown) {
                const e = err as { stdout?: string; stderr?: string; code?: number };
                return {
                    stdout: e.stdout ?? "",
                    stderr: e.stderr ?? "",
                    exitCode: e.code ?? 1,
                };
            }
        },

        async spawn(cmd: string, args: string[], spawnOptions?: { cwd?: string; detached?: boolean; env?: Record<string, string> }): Promise<void> {
            return new Promise((resolve, reject) => {
                const child = _spawn(cmd, args, {
                    cwd: spawnOptions?.cwd,
                    detached: spawnOptions?.detached,
                    env: spawnOptions?.env ? { ...process.env, ...spawnOptions.env } : undefined,
                    stdio: "inherit",
                });
                if (spawnOptions?.detached) {
                    child.unref();
                    resolve();
                } else {
                    child.on("close", (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`${cmd} exited with code ${code}`));
                    });
                    child.on("error", reject);
                }
            });
        },
    };

    const prompter = createPrompter({ yes: options.yes ?? false });
    const logger = createLogger({
        verbose: options.verbose ?? false,
        quiet: options.quiet ?? false,
    });

    return { fs, http, git, shell, prompter, logger };
}
