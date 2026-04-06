import { dirname } from "node:path";
import type { Config, FileSystem } from "./types.js";

export const DEFAULT_REPO_URL = "https://github.com/theokyr/vencord-plugins/releases/latest/download/plugins.json";

export const DEFAULT_CONFIG: Config = {
    repos: [{ name: "kamaras", url: DEFAULT_REPO_URL }],
    vencord: { path: null },
    rebuild: "ask",
    discord: { restart: "ask", binary: null },
};

export function mergeConfig(partial: Partial<Config>): Config {
    return {
        repos: partial.repos ?? DEFAULT_CONFIG.repos,
        vencord: { path: partial.vencord?.path ?? DEFAULT_CONFIG.vencord.path },
        rebuild: partial.rebuild ?? DEFAULT_CONFIG.rebuild,
        discord: {
            restart: partial.discord?.restart ?? DEFAULT_CONFIG.discord.restart,
            binary: partial.discord?.binary ?? DEFAULT_CONFIG.discord.binary,
        },
    };
}

export async function loadConfig(fs: FileSystem, configPath: string): Promise<Config> {
    const exists = await fs.exists(configPath);
    if (!exists) return { ...DEFAULT_CONFIG };
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return mergeConfig(parsed);
}

export async function saveConfig(fs: FileSystem, configPath: string, config: Config): Promise<void> {
    await fs.mkdir(dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}
