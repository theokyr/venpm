import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileSystem, GitClient, HttpClient, InstallPlanEntry } from "../../src/core/types.js";
import {
    fetchViaGit,
    fetchViaTarball,
    fetchViaLocal,
    fetchPlugin,
} from "../../src/core/fetcher.js";

// Mock tar and fs/promises for tarball extraction so tests don't need real tarballs
vi.mock("tar", () => ({
    extract: vi.fn(async () => {}),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        writeFile: vi.fn(async () => {}),
        unlink: vi.fn(async () => {}),
    };
});

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeMockFs(): jest.Mocked<FileSystem> & { _symlinks: Record<string, string>; _dirs: string[] } {
    const _symlinks: Record<string, string> = {};
    const _dirs: string[] = [];
    return {
        _symlinks,
        _dirs,
        readFile: vi.fn().mockResolvedValue(""),
        writeFile: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        mkdir: vi.fn().mockImplementation(async (path: string) => { _dirs.push(path); }),
        rm: vi.fn().mockResolvedValue(undefined),
        symlink: vi.fn().mockImplementation(async (target: string, path: string) => { _symlinks[path] = target; }),
        readlink: vi.fn().mockResolvedValue(""),
        readdir: vi.fn().mockResolvedValue([]),
        stat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 0 }),
        lstat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }),
        copyDir: vi.fn().mockResolvedValue(undefined),
    } as any;
}

function makeMockGit(revParseResult = "abc1234567890"): jest.Mocked<GitClient> {
    return {
        available: vi.fn().mockResolvedValue(true),
        clone: vi.fn().mockResolvedValue(undefined),
        pull: vi.fn().mockResolvedValue(undefined),
        revParse: vi.fn().mockResolvedValue(revParseResult),
        checkout: vi.fn().mockResolvedValue(undefined),
    } as any;
}

function makeMockHttp(ok = true, status = 200): jest.Mocked<HttpClient> {
    return {
        fetch: vi.fn().mockResolvedValue({
            ok,
            status,
            text: vi.fn().mockResolvedValue(""),
            json: vi.fn().mockResolvedValue({}),
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        }),
    } as any;
}

function makeEntry(overrides: Partial<InstallPlanEntry> = {}): InstallPlanEntry {
    return {
        name: "channelTabs",
        version: "1.0.0",
        repo: "kamaras",
        source: { git: "https://example.com/repo.git" },
        method: "git",
        isDependency: false,
        ...overrides,
    };
}

// ─── fetchViaGit ──────────────────────────────────────────────────────────────

describe("fetchViaGit", () => {
    it("clones to destination and returns git_ref", async () => {
        const git = makeMockGit("deadbeef");
        const fs = makeMockFs();

        const result = await fetchViaGit(git, fs, "https://example.com/repo.git", "/dest/channelTabs");

        expect(git.clone).toHaveBeenCalledWith(
            "https://example.com/repo.git",
            "/dest/channelTabs",
            { branch: undefined },
        );
        expect(git.revParse).toHaveBeenCalledWith("/dest/channelTabs", "HEAD");
        expect(result.method).toBe("git");
        expect(result.git_ref).toBe("deadbeef");
        expect(result.path).toBeUndefined();
    });

    it("checks out tag when provided", async () => {
        const git = makeMockGit("tagged123");
        const fs = makeMockFs();

        const result = await fetchViaGit(git, fs, "https://example.com/repo.git", "/dest/plugin", { tag: "v2.0.0" });

        expect(git.clone).toHaveBeenCalledWith(
            "https://example.com/repo.git",
            "/dest/plugin",
            { branch: "v2.0.0" },
        );
        expect(git.checkout).toHaveBeenCalledWith("/dest/plugin", "v2.0.0");
        expect(result.git_ref).toBe("tagged123");
    });

    it("uses sparse checkout when path is provided", async () => {
        const git = makeMockGit("sparse456");
        const fs = makeMockFs();

        const result = await fetchViaGit(
            git, fs,
            "https://example.com/mono.git",
            "/dest/myPlugin",
            { path: "plugins/myPlugin" },
        );

        // Should clone with sparse option to a temp dir (not dest)
        expect(git.clone).toHaveBeenCalledOnce();
        const cloneCall = git.clone.mock.calls[0];
        expect(cloneCall[0]).toBe("https://example.com/mono.git");
        expect(cloneCall[1]).not.toBe("/dest/myPlugin"); // cloned to temp
        expect(cloneCall[2]).toMatchObject({ sparse: ["plugins/myPlugin"] });

        // Should copy from temp subdir to dest
        expect(fs.copyDir).toHaveBeenCalledOnce();
        const [copySrc, copyDest] = fs.copyDir.mock.calls[0];
        expect(copySrc).toContain("plugins/myPlugin");
        expect(copyDest).toBe("/dest/myPlugin");

        // Should clean up temp dir
        expect(fs.rm).toHaveBeenCalledWith(
            expect.stringContaining("venpm-tmp-"),
            { recursive: true, force: true },
        );

        expect(result.method).toBe("git");
        expect(result.git_ref).toBe("sparse456");
        expect(result.path).toBe("plugins/myPlugin");
    });

    it("checks out tag in sparse checkout mode", async () => {
        const git = makeMockGit("sparseTag789");
        const fs = makeMockFs();

        await fetchViaGit(
            git, fs,
            "https://example.com/mono.git",
            "/dest/plugin",
            { path: "plugins/plugin", tag: "v1.5.0" },
        );

        expect(git.checkout).toHaveBeenCalledWith(
            expect.stringContaining("venpm-tmp-"),
            "v1.5.0",
        );
    });
});

// ─── fetchViaTarball ──────────────────────────────────────────────────────────

describe("fetchViaTarball", () => {
    it("downloads from URL and creates dest directory", async () => {
        const http = makeMockHttp(true, 200);
        const fs = makeMockFs();

        const result = await fetchViaTarball(http, fs, "https://example.com/plugin.tar.gz", "/dest/plugin");

        expect(http.fetch).toHaveBeenCalledWith("https://example.com/plugin.tar.gz");
        expect(fs.mkdir).toHaveBeenCalledWith("/dest/plugin", { recursive: true });
        expect(result.method).toBe("tarball");
    });

    it("throws on HTTP error response", async () => {
        const http = makeMockHttp(false, 404);
        const fs = makeMockFs();

        await expect(
            fetchViaTarball(http, fs, "https://example.com/missing.tar.gz", "/dest/plugin"),
        ).rejects.toThrow("HTTP 404");
    });

    it("throws on server error (500)", async () => {
        const http = makeMockHttp(false, 500);
        const fs = makeMockFs();

        await expect(
            fetchViaTarball(http, fs, "https://example.com/error.tar.gz", "/dest/plugin"),
        ).rejects.toThrow("HTTP 500");
    });
});

// ─── fetchViaLocal ────────────────────────────────────────────────────────────

describe("fetchViaLocal", () => {
    it("creates a symlink from dest to local path", async () => {
        const fs = makeMockFs();
        fs.exists.mockResolvedValue(true);

        const result = await fetchViaLocal(fs, "/home/user/dev/myPlugin", "/dest/myPlugin");

        expect(fs.symlink).toHaveBeenCalledWith("/home/user/dev/myPlugin", "/dest/myPlugin");
        expect(result.method).toBe("local");
    });

    it("throws when local path does not exist", async () => {
        const fs = makeMockFs();
        fs.exists.mockResolvedValue(false);

        await expect(
            fetchViaLocal(fs, "/nonexistent/path", "/dest/myPlugin"),
        ).rejects.toThrow("Local path not found: /nonexistent/path");
    });
});

// ─── fetchPlugin ─────────────────────────────────────────────────────────────

describe("fetchPlugin", () => {
    const userpluginDir = "/home/user/.config/Vencord/src/userplugins";

    it("dispatches to git for git method", async () => {
        const git = makeMockGit("gitRef");
        const fs = makeMockFs();
        const http = makeMockHttp();

        const entry = makeEntry({ method: "git", source: { git: "https://example.com/repo.git" } });
        const result = await fetchPlugin(entry, userpluginDir, { fs, git, http });

        expect(git.clone).toHaveBeenCalledOnce();
        expect(result.method).toBe("git");
        expect(result.git_ref).toBe("gitRef");
    });

    it("dispatches to tarball for tarball method", async () => {
        const git = makeMockGit();
        const fs = makeMockFs();
        const http = makeMockHttp();

        const entry = makeEntry({
            method: "tarball",
            source: { tarball: "https://example.com/plugin.tar.gz" },
        });
        const result = await fetchPlugin(entry, userpluginDir, { fs, git, http });

        expect(http.fetch).toHaveBeenCalledWith("https://example.com/plugin.tar.gz");
        expect(result.method).toBe("tarball");
    });

    it("dispatches to local for local method", async () => {
        const git = makeMockGit();
        const fs = makeMockFs();
        const http = makeMockHttp();
        fs.exists.mockResolvedValue(true);

        const entry = makeEntry({
            method: "local",
            source: { local: "/home/user/dev/channelTabs" },
        });
        const result = await fetchPlugin(entry, userpluginDir, { fs, git, http });

        expect(fs.symlink).toHaveBeenCalledWith(
            "/home/user/dev/channelTabs",
            `${userpluginDir}/channelTabs`,
        );
        expect(result.method).toBe("local");
    });

    it("throws when git method has no git URL", async () => {
        const git = makeMockGit();
        const fs = makeMockFs();
        const http = makeMockHttp();

        const entry = makeEntry({ method: "git", source: {} });
        await expect(fetchPlugin(entry, userpluginDir, { fs, git, http })).rejects.toThrow(
            'Plugin "channelTabs" has no git URL',
        );
    });

    it("throws when tarball method has no tarball URL", async () => {
        const git = makeMockGit();
        const fs = makeMockFs();
        const http = makeMockHttp();

        const entry = makeEntry({ method: "tarball", source: {} });
        await expect(fetchPlugin(entry, userpluginDir, { fs, git, http })).rejects.toThrow(
            'Plugin "channelTabs" has no tarball URL',
        );
    });

    it("throws when local method has no local path", async () => {
        const git = makeMockGit();
        const fs = makeMockFs();
        const http = makeMockHttp();

        const entry = makeEntry({ method: "local", source: {} });
        await expect(fetchPlugin(entry, userpluginDir, { fs, git, http })).rejects.toThrow(
            'Plugin "channelTabs" has no local path',
        );
    });

    it("constructs dest path as userpluginDir/name", async () => {
        const git = makeMockGit("ref");
        const fs = makeMockFs();
        const http = makeMockHttp();

        const entry = makeEntry({ name: "myPlugin", method: "git", source: { git: "https://example.com/r.git" } });
        await fetchPlugin(entry, userpluginDir, { fs, git, http });

        const cloneDest = git.clone.mock.calls[0][1];
        expect(cloneDest).toBe(`${userpluginDir}/myPlugin`);
    });
});
