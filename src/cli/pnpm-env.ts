import type { GlobalOptions } from "../core/types.js";

interface PnpmEnvRuntime {
    stdoutIsTTY?: boolean;
    ci?: string;
}

/**
 * pnpm prompts before recreating node_modules unless it knows the caller is
 * intentionally non-interactive. Apply that only for explicit yes-like modes.
 */
export function createPnpmEnvForNonInteractiveYes(
    options: Pick<GlobalOptions, "yes" | "json" | "jsonStream">,
    runtime: PnpmEnvRuntime = {
        stdoutIsTTY: process.stdout.isTTY,
        ci: process.env.CI,
    }
): Record<string, string> | undefined {
    const effectiveYes = options.yes === true || options.json === true || options.jsonStream === true;
    if (!effectiveYes || runtime.stdoutIsTTY || runtime.ci !== undefined) {
        return undefined;
    }

    return { CI: "true" };
}
