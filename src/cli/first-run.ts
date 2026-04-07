import type { IOContext } from "../core/types.js";
import { getConfigPath } from "../core/paths.js";
import { saveConfig, DEFAULT_CONFIG } from "../core/config.js";
import { detectVencordPath } from "../core/detect.js";

const COMMANDS_NEEDING_CONFIG = new Set([
    "install", "uninstall", "update", "list", "search", "info",
    "repo", "rebuild", "doctor",
]);

export function needsFirstRun(commandName: string): boolean {
    return COMMANDS_NEEDING_CONFIG.has(commandName);
}

export async function runFirstTimeSetup(ctx: IOContext, version: string): Promise<boolean> {
    const configPath = getConfigPath();
    const configExists = await ctx.fs.exists(configPath);

    if (configExists) return false;

    try {
        ctx.renderer.heading(`venpm v${version}`);
        ctx.renderer.text("");
        ctx.renderer.text("First time? Let's set up.");
        ctx.renderer.text("");

        const detected = await detectVencordPath(ctx.fs);
        let vencordPath: string;
        if (detected) {
            const useDetected = await ctx.prompter.confirm(
                `Vencord source path: ${detected}`,
                true,
            );
            if (useDetected) {
                vencordPath = detected;
            } else {
                vencordPath = await ctx.prompter.input("Vencord source path:");
            }
        } else {
            vencordPath = await ctx.prompter.input("Vencord source path:");
        }

        const addCommunity = await ctx.prompter.confirm(
            "Add the community plugin repo?",
            true,
        );

        const config = { ...DEFAULT_CONFIG };
        config.vencord = { ...config.vencord, path: vencordPath || null };
        if (!addCommunity) {
            config.repos = [];
        }

        await saveConfig(ctx.fs, configPath, config);
        ctx.renderer.success(`Config saved to ${configPath}`);
        ctx.renderer.text("");
        ctx.renderer.text("Run venpm search to browse available plugins.");
        return true;
    } catch {
        return false;
    }
}
