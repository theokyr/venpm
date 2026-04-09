import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile as writeFileRaw, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extract } from "tar";
import type { FileSystem, GitClient, HttpClient, InstallPlanEntry } from "./types.js";
import type { FetchMethod } from "./types.js";

// ─── Result type ─────────────────────────────────────────────────────────────

export interface FetchResult {
    method: FetchMethod;
    /** Git commit hash (only set when method === "git") */
    git_ref?: string;
    /** Subdirectory path within the plugin dir (carried through from source) */
    path?: string;
}

// ─── fetchViaGit ──────────────────────────────────────────────────────────────

export async function fetchViaGit(
    git: GitClient,
    fs: FileSystem,
    gitUrl: string,
    dest: string,
    options: { path?: string; tag?: string } = {},
): Promise<FetchResult> {
    const { path: subPath, tag } = options;

    if (subPath) {
        // Sparse checkout: clone to a temp dir, copy the subdir, clean up.
        const tempDir = join(dest, "..", `venpm-tmp-${randomUUID()}`);

        await git.clone(gitUrl, tempDir, { sparse: [subPath], branch: tag });

        if (tag) {
            await git.checkout(tempDir, tag);
        }

        const git_ref = await git.revParse(tempDir, "HEAD");

        // Copy the subdirectory out to the final destination.
        const subSrc = join(tempDir, subPath);
        await fs.mkdir(dest, { recursive: true });
        await fs.copyDir(subSrc, dest);

        // Clean up the temp clone.
        await fs.rm(tempDir, { recursive: true, force: true });

        return { method: "git", git_ref, path: subPath };
    }

    // Simple full clone.
    await git.clone(gitUrl, dest, { branch: tag });

    if (tag) {
        await git.checkout(dest, tag);
    }

    const git_ref = await git.revParse(dest, "HEAD");

    return { method: "git", git_ref };
}

// ─── fetchViaTarball ──────────────────────────────────────────────────────────

export async function fetchViaTarball(
    http: HttpClient,
    fs: FileSystem,
    tarballUrl: string,
    dest: string,
): Promise<FetchResult> {
    const response = await http.fetch(tarballUrl);

    if (!response.ok) {
        throw new Error(
            `Failed to download tarball from ${tarballUrl}: HTTP ${response.status}`,
        );
    }

    // Download the buffer, write to a temp file, extract, then clean up.
    const buffer = Buffer.from(await response.arrayBuffer());
    const tmpPath = join(tmpdir(), `venpm-tarball-${randomUUID()}.tar.gz`);
    await writeFileRaw(tmpPath, buffer);
    await fs.mkdir(dest, { recursive: true });
    try {
        await extract({ file: tmpPath, cwd: dest, strip: 1 });
    } finally {
        await unlink(tmpPath).catch(() => {});
    }

    return { method: "tarball" };
}

// ─── fetchViaLocal ────────────────────────────────────────────────────────────

export async function fetchViaLocal(
    fs: FileSystem,
    localPath: string,
    dest: string,
): Promise<FetchResult> {
    const found = await fs.exists(localPath);

    if (!found) {
        throw new Error(`Local path not found: ${localPath}`);
    }

    await fs.symlink(localPath, dest);

    return { method: "local" };
}

// ─── fetchPlugin ─────────────────────────────────────────────────────────────

export async function fetchPlugin(
    entry: InstallPlanEntry,
    userpluginDir: string,
    ctx: { fs: FileSystem; git: GitClient; http: HttpClient },
): Promise<FetchResult> {
    const { source, name } = entry;
    const dest = join(userpluginDir, name);

    switch (entry.method) {
        case "git": {
            if (!source.git) {
                throw new Error(`Plugin "${name}" has no git URL in source`);
            }
            // Only pass a tag if the version entry has an explicit git_tag
            const versionEntry = entry.versionEntry;
            const tag = versionEntry?.git_tag;
            return fetchViaGit(ctx.git, ctx.fs, source.git, dest, {
                path: source.path,
                tag,
            });
        }

        case "tarball": {
            const tarballUrl = source.tarball;
            if (!tarballUrl) {
                throw new Error(`Plugin "${name}" has no tarball URL in source`);
            }
            return fetchViaTarball(ctx.http, ctx.fs, tarballUrl, dest);
        }

        case "local": {
            if (!source.local) {
                throw new Error(`Plugin "${name}" has no local path in source`);
            }
            return fetchViaLocal(ctx.fs, source.local, dest);
        }

        default: {
            throw new Error(`Unknown fetch method: ${(entry as InstallPlanEntry).method}`);
        }
    }
}
