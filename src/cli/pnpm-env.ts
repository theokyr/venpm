import type { GlobalOptions } from "../core/types.js";

/**
 * pnpm prompts before recreating node_modules unless it knows the caller is
 * intentionally non-interactive. Apply that only for explicit yes-like modes.
 */
export function createPnpmEnvForNonInteractiveYes(
    options: Pick<GlobalOptions, "yes" | "json" | "jsonStream">
): Record<string, string> | undefined {
    const effectiveYes = options.yes === true || options.json === true || options.jsonStream === true;
    return effectiveYes ? { CI: "true" } : undefined;
}
