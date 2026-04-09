import type { Command } from "commander";
import type { GlobalOptions } from "../core/types.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { getConfigPath, getConfigDir } from "../core/paths.js";
import { ErrorCode, makeError, exitCodeForError } from "../core/errors.js";
import { findCandidates } from "../core/fuzzy.js";
import { createRealIOContext } from "./context.js";

function getNestedValue(obj: unknown, keys: string[]): unknown {
    let current: unknown = obj;
    for (const key of keys) {
        if (current === null || current === undefined || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function setNestedValue(obj: Record<string, unknown>, keys: string[], value: unknown): void {
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === null || current[key] === undefined || typeof current[key] !== "object") {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
}

function coerceValue(raw: string): unknown {
    if (raw === "null") return null;
    if (raw === "true") return true;
    if (raw === "false") return false;
    // Try JSON parse for numbers/arrays/objects
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** Collect all dotted key paths from a config object for fuzzy matching. */
function collectConfigKeys(obj: unknown, prefix = ""): string[] {
    if (obj === null || obj === undefined || typeof obj !== "object") return [];
    const keys: string[] = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${k}` : k;
        keys.push(path);
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            keys.push(...collectConfigKeys(v, path));
        }
    }
    return keys;
}

export function registerConfigCommand(program: Command): void {
    const config = program
        .command("config")
        .description("View or edit venpm configuration");

    config
        .command("set <key> <value>")
        .description("Set a configuration value (dotted key path)")
        .action(async (key: string, value: string) => {
            const parentOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(parentOpts);
            const { renderer } = ctx;
            const configPath = parentOpts.config ?? getConfigPath();
            const cfg = await loadConfig(ctx.fs, configPath);

            const keys = key.split(".");
            const coerced = coerceValue(value);
            setNestedValue(cfg as unknown as Record<string, unknown>, keys, coerced);
            await saveConfig(ctx.fs, configPath, cfg);

            renderer.success(`Set ${key} = ${JSON.stringify(coerced)}`);
            renderer.finish(true, { key, value: coerced });
        });

    config
        .command("get <key>")
        .description("Get a configuration value (dotted key path)")
        .action(async (key: string) => {
            const parentOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(parentOpts);
            const { renderer } = ctx;
            const configPath = parentOpts.config ?? getConfigPath();
            const cfg = await loadConfig(ctx.fs, configPath);

            const keys = key.split(".");
            const value = getNestedValue(cfg, keys);
            if (value === undefined) {
                const allKeys = collectConfigKeys(cfg);
                const candidates = findCandidates(key, allKeys);
                renderer.error(makeError(ErrorCode.SCHEMA_INVALID, `Key "${key}" not found in config`, { candidates }));
                renderer.finish(false);
                process.exitCode = exitCodeForError(ErrorCode.SCHEMA_INVALID);
                return;
            }
            renderer.text(JSON.stringify(value, null, 2));
            renderer.finish(true, { key, value });
        });

    config
        .command("path")
        .description("Print the venpm config directory path")
        .action(() => {
            const parentOpts = program.opts<GlobalOptions>();
            const ctx = createRealIOContext(parentOpts);
            const { renderer } = ctx;
            renderer.text(getConfigDir());
            renderer.finish(true, { path: getConfigDir() });
        });
}
