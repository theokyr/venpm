import { describe, it, expect, vi } from "vitest";
import type { FileSystem } from "../../src/core/types.js";
import {
    DEFAULT_CONFIG,
    DEFAULT_REPO_URL,
    mergeConfig,
    loadConfig,
    saveConfig,
} from "../../src/core/config.js";

function mockFs(files: Record<string, string> = {}): FileSystem {
    const store = { ...files };
    return {
        readFile: vi.fn(async (path: string) => {
            if (store[path] === undefined) throw new Error(`ENOENT: ${path}`);
            return store[path];
        }),
        writeFile: vi.fn(async (path: string, content: string) => {
            store[path] = content;
        }),
        exists: vi.fn(async (path: string) => path in store),
        mkdir: vi.fn(async () => {}),
        rm: vi.fn(async () => {}),
        symlink: vi.fn(async () => {}),
        readlink: vi.fn(async () => ""),
        readdir: vi.fn(async () => [] as string[]),
        stat: vi.fn(async () => ({ isDirectory: () => false, isFile: () => true, size: 0 })),
        lstat: vi.fn(async () => ({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })),
        copyDir: vi.fn(async () => {}),
    };
}

describe("DEFAULT_CONFIG", () => {
    it("has kamaras as the default repo", () => {
        expect(DEFAULT_CONFIG.repos).toHaveLength(1);
        expect(DEFAULT_CONFIG.repos[0].name).toBe("kamaras");
        expect(DEFAULT_CONFIG.repos[0].url).toBe(DEFAULT_REPO_URL);
    });

    it("defaults rebuild to 'ask'", () => {
        expect(DEFAULT_CONFIG.rebuild).toBe("ask");
    });

    it("defaults discord restart to 'ask'", () => {
        expect(DEFAULT_CONFIG.discord.restart).toBe("ask");
    });

    it("defaults vencord path to null", () => {
        expect(DEFAULT_CONFIG.vencord.path).toBeNull();
    });
});

describe("mergeConfig", () => {
    it("overrides defaults with provided values", () => {
        const result = mergeConfig({
            repos: [{ name: "custom", url: "https://example.com/plugins.json" }],
            rebuild: "always",
        });
        expect(result.repos[0].name).toBe("custom");
        expect(result.rebuild).toBe("always");
    });

    it("deep merges discord settings", () => {
        const result = mergeConfig({
            discord: { restart: "never", binary: "/usr/bin/discord" },
        });
        expect(result.discord.restart).toBe("never");
        expect(result.discord.binary).toBe("/usr/bin/discord");
    });

    it("preserves defaults when called with an empty object", () => {
        const result = mergeConfig({});
        expect(result.repos).toEqual(DEFAULT_CONFIG.repos);
        expect(result.rebuild).toBe(DEFAULT_CONFIG.rebuild);
        expect(result.vencord.path).toBeNull();
        expect(result.discord.restart).toBe(DEFAULT_CONFIG.discord.restart);
        expect(result.discord.binary).toBeNull();
    });
});

describe("loadConfig", () => {
    it("returns defaults when file doesn't exist", async () => {
        const fs = mockFs();
        const result = await loadConfig(fs, "/home/user/.config/venpm/config.json");
        expect(result).toEqual(DEFAULT_CONFIG);
    });

    it("parses an existing config file", async () => {
        const config = {
            repos: [{ name: "myrepo", url: "https://example.com/plugins.json" }],
            vencord: { path: "/home/user/Vencord" },
            rebuild: "always",
            discord: { restart: "never", binary: "/usr/bin/discord" },
        };
        const fs = mockFs({ "/home/user/.config/venpm/config.json": JSON.stringify(config) });
        const result = await loadConfig(fs, "/home/user/.config/venpm/config.json");
        expect(result.repos[0].name).toBe("myrepo");
        expect(result.vencord.path).toBe("/home/user/Vencord");
        expect(result.rebuild).toBe("always");
        expect(result.discord.restart).toBe("never");
        expect(result.discord.binary).toBe("/usr/bin/discord");
    });

    it("merges a partial config with defaults", async () => {
        const partial = { rebuild: "never" };
        const fs = mockFs({ "/home/user/.config/venpm/config.json": JSON.stringify(partial) });
        const result = await loadConfig(fs, "/home/user/.config/venpm/config.json");
        expect(result.rebuild).toBe("never");
        expect(result.repos).toEqual(DEFAULT_CONFIG.repos);
        expect(result.discord.restart).toBe("ask");
    });
});

describe("saveConfig", () => {
    it("writes formatted JSON with trailing newline", async () => {
        const fs = mockFs();
        const config = { ...DEFAULT_CONFIG };
        await saveConfig(fs, "/home/user/.config/venpm/config.json", config);
        expect(fs.mkdir).toHaveBeenCalledWith("/home/user/.config/venpm", { recursive: true });
        expect(fs.writeFile).toHaveBeenCalledOnce();
        const [, written] = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(written).toBe(JSON.stringify(config, null, 2) + "\n");
    });
});
