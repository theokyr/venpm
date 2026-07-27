import { execFile as _execFile, spawn as _spawn } from "node:child_process";
import { promisify } from "node:util";
import * as fsPromises from "node:fs/promises";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { createPrompter } from "../core/prompt.js";
import { shouldColorize } from "../core/ansi.js";
import { createPlainRenderer, createTtyRenderer } from "../core/renderer.js";
import { createJsonRenderer } from "../core/json-renderer.js";
import { createStreamRenderer } from "../core/stream-renderer.js";
import type { IOContext, FileSystem, HttpClient, GitClient, ShellRunner, GlobalOptions, SpawnOptions } from "../core/types.js";
import { writeStdout } from "./output.js";

const execFileAsync = promisify(_execFile);

export function createRealIOContext(options: GlobalOptions): IOContext {
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

        async rename(src: string, dest: string): Promise<void> {
            await fsPromises.rename(src, dest);
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

        async spawn(cmd: string, args: string[], spawnOptions?: SpawnOptions): Promise<void> {
            return new Promise((resolve, reject) => {
                let child: ReturnType<typeof _spawn>;

                let childEnv: NodeJS.ProcessEnv | undefined;
                if (spawnOptions?.env || spawnOptions?.unsetEnv?.length) {
                    childEnv = { ...process.env, ...spawnOptions.env };
                    for (const key of spawnOptions.unsetEnv ?? []) delete childEnv[key];
                }

                // A log file keeps a failed launch diagnosable; without one the child's
                // stderr goes nowhere and "it just didn't start" is all the caller knows.
                let stdio: "ignore" | ["ignore", number, number] = "ignore";
                let logFd: number | undefined;
                if (spawnOptions?.logFile) {
                    try {
                        mkdirSync(dirname(spawnOptions.logFile), { recursive: true });
                        logFd = openSync(spawnOptions.logFile, "w");
                        stdio = ["ignore", logFd, logFd];
                    } catch {
                        // Logging is best-effort — never block a launch on it.
                    }
                }

                try {
                    child = _spawn(cmd, args, {
                        cwd: spawnOptions?.cwd,
                        detached: spawnOptions?.detached,
                        env: childEnv,
                        stdio,
                    });
                } catch (err) {
                    if (logFd !== undefined) closeSync(logFd);
                    reject(err);
                    return;
                }

                let settled = false;
                let detachedTimer: NodeJS.Timeout | undefined;
                const cleanup = () => {
                    if (detachedTimer) clearTimeout(detachedTimer);
                    // The child holds its own duplicate of the fd; ours would leak.
                    if (logFd !== undefined) {
                        try { closeSync(logFd); } catch { /* already closed */ }
                        logFd = undefined;
                    }
                    child.off("error", onError);
                    child.off("close", onClose);
                };
                const settle = (fn: () => void) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    fn();
                };
                const onError = (err: Error) => settle(() => reject(err));
                const onClose = (code: number | null) => settle(() => {
                    if (code === 0) resolve();
                    else reject(new Error(`${cmd} exited with code ${code}`));
                });

                child.once("error", onError);
                if (spawnOptions?.detached) {
                    child.unref();
                    detachedTimer = setTimeout(() => settle(resolve), 50);
                } else {
                    child.once("close", onClose);
                }
            });
        },
    };

    const isJson = options.json ?? false;
    const jsonStream = options.jsonStream ?? false;

    const nonInteractive = !process.stdin.isTTY && !options.yes && !isJson && !jsonStream;
    const prompter = createPrompter({
        yes: options.yes || isJson || jsonStream || false,
        nonInteractive,
    });

    let renderer: IOContext["renderer"];
    if (jsonStream) {
        renderer = createStreamRenderer(writeStdout);
    } else if (isJson) {
        renderer = createJsonRenderer(writeStdout);
    } else if (process.env["FORCE_COLOR"]) {
        renderer = createTtyRenderer({ verbose: options.verbose ?? false, quiet: options.quiet ?? false }, writeStdout);
    } else if (!shouldColorize(process.stdout) || (options as Record<string, unknown>).color === false) {
        renderer = createPlainRenderer({ verbose: options.verbose ?? false, quiet: options.quiet ?? false }, writeStdout);
    } else {
        renderer = createTtyRenderer({ verbose: options.verbose ?? false, quiet: options.quiet ?? false }, writeStdout);
    }

    return { fs, http, git, shell, prompter, renderer };
}
