import { describe, it, expect, vi } from "vitest";
import type { FileSystem, IOContext } from "../../src/core/types.js";
import {
    detectCreateMode,
    executeCreate,
    type CreateOptions,
} from "../../src/cli/create.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockFs(files: Record<string, string> = {}): FileSystem & {
    written: Record<string, string>;
    created: string[];
} {
    const store = { ...files };
    const written: Record<string, string> = {};
    const created: string[] = [];
    return {
        written,
        created,
        readFile: vi.fn(async (path: string) => {
            if (!(path in store)) throw new Error(`ENOENT: ${path}`);
            return store[path];
        }),
        writeFile: vi.fn(async (path: string, data: string) => {
            store[path] = data;
            written[path] = data;
        }),
        exists: vi.fn(async (path: string) => path in store),
        mkdir: vi.fn(async (path: string) => {
            created.push(path);
        }),
        rm: vi.fn(async () => {}),
        symlink: vi.fn(async () => {}),
        readlink: vi.fn(async () => ""),
        readdir: vi.fn(async () => [] as string[]),
        stat: vi.fn(async () => ({ isDirectory: () => false, isFile: () => true, size: 0 })),
        lstat: vi.fn(async () => ({
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
        })),
        copyDir: vi.fn(async () => {}),
    };
}

function makeCtx(fs: FileSystem): IOContext {
    return {
        fs,
        http: { fetch: vi.fn() as never },
        git: {
            available: vi.fn(async () => true),
            clone: vi.fn(async () => {}),
            pull: vi.fn(async () => {}),
            revParse: vi.fn(async () => "abc1234"),
            checkout: vi.fn(async () => {}),
        },
        shell: {
            exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
            spawn: vi.fn(async () => {}),
        },
        prompter: {
            confirm: vi.fn(async () => true),
            input: vi.fn(async (_, def) => def ?? ""),
            select: vi.fn(async (_, choices) => choices[0].value),
        },
        renderer: {
            text: vi.fn(),
            heading: vi.fn(),
            success: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            verbose: vi.fn(),
            dim: vi.fn(),
            table: vi.fn(),
            keyValue: vi.fn(),
            list: vi.fn(),
            progress: vi.fn(() => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
            write: vi.fn(),
            finish: vi.fn(),
        },
    };
}

// ─── detectCreateMode ─────────────────────────────────────────────────────────

describe("detectCreateMode", () => {
    it("returns 'repo' for a fresh path with no ancestor plugins.json", async () => {
        const fs = makeMockFs();
        // No files at all — fresh directory
        const mode = await detectCreateMode(fs, "/tmp/my-new-repo");
        expect(mode).toBe("repo");
    });

    it("returns 'repo' when ancestor has plugins.json without venpm schema", async () => {
        const fs = makeMockFs({
            "/home/user/plugins.json": JSON.stringify({ name: "other", plugins: {} }),
        });
        const mode = await detectCreateMode(fs, "/home/user/my-new-repo");
        expect(mode).toBe("repo");
    });

    it("returns 'plugin' when direct parent directory has a venpm plugins.json", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": JSON.stringify({
                $schema: "https://venpm.dev/schemas/v1/plugins.json",
                name: "myrepo",
                plugins: {},
            }),
        });
        const mode = await detectCreateMode(fs, "/home/user/myrepo/MyPlugin");
        expect(mode).toBe("plugin");
    });

    it("returns 'plugin' when ancestor plugins.json is multiple levels up", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": JSON.stringify({
                $schema: "https://venpm.dev/schemas/v1/plugins.json",
                name: "myrepo",
                plugins: {},
            }),
        });
        const mode = await detectCreateMode(fs, "/home/user/myrepo/subdir/deep/MyPlugin");
        expect(mode).toBe("plugin");
    });

    it("returns 'repo' when plugins.json has malformed JSON", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": "{ not valid json !!",
        });
        const mode = await detectCreateMode(fs, "/home/user/myrepo/MyPlugin");
        expect(mode).toBe("repo");
    });
});

// ─── executeCreate — repo mode ────────────────────────────────────────────────

describe("executeCreate (repo mode)", () => {
    it("creates plugins/, plugins.json, .github/workflows/publish.yml, and README.md", async () => {
        const fs = makeMockFs();
        const ctx = makeCtx(fs);
        const options: CreateOptions = {};

        await executeCreate(ctx, "/tmp/my-new-repo", options);

        // plugins directory created
        expect(fs.created).toContain("/tmp/my-new-repo/plugins");

        // plugins.json written
        expect(fs.written).toHaveProperty("/tmp/my-new-repo/plugins.json");
        const pluginsJson = JSON.parse(fs.written["/tmp/my-new-repo/plugins.json"]);
        expect(pluginsJson.$schema).toContain("venpm");
        expect(pluginsJson.name).toBe("my-new-repo");
        expect(pluginsJson.plugins).toEqual({});

        // GitHub Action workflow written
        expect(fs.written).toHaveProperty("/tmp/my-new-repo/.github/workflows/publish.yml");
        expect(fs.written["/tmp/my-new-repo/.github/workflows/publish.yml"]).toContain("venpm validate");

        // README.md written
        expect(fs.written).toHaveProperty("/tmp/my-new-repo/README.md");
        expect(fs.written["/tmp/my-new-repo/README.md"]).toContain("my-new-repo");
    });
});

// ─── executeCreate — plugin mode ─────────────────────────────────────────────

describe("executeCreate (plugin mode)", () => {
    const ancestorPluginsJson = JSON.stringify({
        $schema: "https://venpm.dev/schemas/v1/plugins.json",
        name: "myrepo",
        description: "test repo",
        plugins: {},
    });

    it("creates index.ts by default and updates plugins.json", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": ancestorPluginsJson,
        });
        const ctx = makeCtx(fs);
        const options: CreateOptions = {};

        await executeCreate(ctx, "/home/user/myrepo/plugins/CoolPlugin", options);

        expect(fs.written).toHaveProperty("/home/user/myrepo/plugins/CoolPlugin/index.ts");
        expect(fs.written["/home/user/myrepo/plugins/CoolPlugin/index.ts"]).toContain("definePlugin");
        expect(fs.written["/home/user/myrepo/plugins/CoolPlugin/index.ts"]).toContain("CoolPlugin");

        // plugins.json updated
        expect(fs.written).toHaveProperty("/home/user/myrepo/plugins.json");
        const updated = JSON.parse(fs.written["/home/user/myrepo/plugins.json"]);
        expect(updated.plugins).toHaveProperty("CoolPlugin");
        expect(updated.plugins.CoolPlugin.version).toBe("0.1.0");
    });

    it("creates index.tsx when --tsx is set", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": ancestorPluginsJson,
        });
        const ctx = makeCtx(fs);
        const options: CreateOptions = { tsx: true };

        await executeCreate(ctx, "/home/user/myrepo/plugins/TsxPlugin", options);

        expect(fs.written).toHaveProperty("/home/user/myrepo/plugins/TsxPlugin/index.tsx");
        expect(fs.written).not.toHaveProperty("/home/user/myrepo/plugins/TsxPlugin/index.ts");
    });

    it("creates style.css when --css is set", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": ancestorPluginsJson,
        });
        const ctx = makeCtx(fs);
        const options: CreateOptions = { css: true };

        await executeCreate(ctx, "/home/user/myrepo/plugins/StyledPlugin", options);

        expect(fs.written).toHaveProperty("/home/user/myrepo/plugins/StyledPlugin/style.css");
    });

    it("creates native.ts when --native is set", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": ancestorPluginsJson,
        });
        const ctx = makeCtx(fs);
        const options: CreateOptions = { native: true };

        await executeCreate(ctx, "/home/user/myrepo/plugins/NativePlugin", options);

        expect(fs.written).toHaveProperty("/home/user/myrepo/plugins/NativePlugin/native.ts");
        expect(fs.written["/home/user/myrepo/plugins/NativePlugin/native.ts"]).toContain("Node.js");
    });

    it("does not create style.css or native.ts when flags are not set", async () => {
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": ancestorPluginsJson,
        });
        const ctx = makeCtx(fs);
        const options: CreateOptions = {};

        await executeCreate(ctx, "/home/user/myrepo/plugins/BasicPlugin", options);

        expect(fs.written).not.toHaveProperty("/home/user/myrepo/plugins/BasicPlugin/style.css");
        expect(fs.written).not.toHaveProperty("/home/user/myrepo/plugins/BasicPlugin/native.ts");
    });

    it("skips plugins.json update when plugin name already exists", async () => {
        const existingIndex = JSON.stringify({
            $schema: "https://venpm.dev/schemas/v1/plugins.json",
            name: "myrepo",
            description: "test repo",
            plugins: {
                ExistingPlugin: {
                    version: "1.0.0",
                    description: "already here",
                    authors: [{ name: "kamaras", id: "0" }],
                    source: { local: "./ExistingPlugin" },
                },
            },
        });
        const fs = makeMockFs({
            "/home/user/myrepo/plugins.json": existingIndex,
        });
        const ctx = makeCtx(fs);
        const options: CreateOptions = {};

        await executeCreate(ctx, "/home/user/myrepo/plugins/ExistingPlugin", options);

        // Should warn but not overwrite
        expect(ctx.renderer.warn).toHaveBeenCalled();
        // The original entry should be preserved
        const finalIndex = JSON.parse(fs.written["/home/user/myrepo/plugins.json"] ?? existingIndex);
        expect(finalIndex.plugins.ExistingPlugin.version).toBe("1.0.0");
    });
});
